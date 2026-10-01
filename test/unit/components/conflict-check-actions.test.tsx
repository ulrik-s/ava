/**
 * Jävskontrollens åtgärder i ärendet (#1246, #1354): kör om, och bedöm
 * träffarna med en motivering — bara advokat eller admin.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { ConflictCheckActions } from "@/components/watchlist/conflict-check-actions";
import { asId } from "@/lib/shared/schemas/ids";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const recheck = vi.fn();
const reviewed = vi.fn();
const invalidate = { watchlist: vi.fn(), matter: vi.fn() };
let pending = false;
let reviewError: { message: string } | null = null;
let me: { id: string; role: string } | undefined = { id: "u1", role: "LAWYER" };
vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ watchlist: { list: { invalidate: invalidate.watchlist } }, matter: { getById: { invalidate: invalidate.matter } } }),
    user: { current: { useQuery: () => ({ data: me }) } },
    matter: {
      checkConflicts: { useMutation: (o: { onSuccess: () => void }) => ({ mutate: (a: unknown) => { recheck(a); o.onSuccess(); }, isPending: pending }) },
      markConflictsReviewed: {
        useMutation: (o: { onSuccess: () => void }) => ({ mutate: (a: unknown) => { reviewed(a); o.onSuccess(); }, isPending: false, error: reviewError }),
      },
    },
  },
}));

const M = asId<"MatterId">("m1");
beforeEach(() => { pending = false; reviewError = null; me = { id: "u1", role: "LAWYER" }; vi.clearAllMocks(); });

const openForm = (): void => {
  render(<ConflictCheckActions matterId={M} hasHits />);
  fireEvent.click(screen.getByRole("button", { name: "Bedöm träffarna" }));
};

describe("ConflictCheckActions", () => {
  it("kör om kontrollen och uppdaterar ärendet och Att bevaka", () => {
    render(<ConflictCheckActions matterId={M} hasHits={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Kör jävskontrollen igen" }));
    expect(recheck).toHaveBeenCalledWith({ id: M });
    expect(invalidate.watchlist).toHaveBeenCalled();
    expect(invalidate.matter).toHaveBeenCalledWith({ id: M });
  });

  it("utan träffar finns inget att bedöma och ingen länk till träffarna", () => {
    render(<ConflictCheckActions matterId={M} hasHits={false} />);
    expect(screen.queryByRole("button", { name: "Bedöm träffarna" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("med träffar: länk till jävskontrollens historik", () => {
    render(<ConflictCheckActions matterId={M} hasHits />);
    expect(screen.getByRole("link", { name: /Se träffarna/ })).toHaveAttribute("href", "/conflicts");
  });

  it("bedömningen kräver en motivering, som skickas med", () => {
    openForm();
    const save = screen.getByRole("button", { name: "Spara bedömning" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Motivering"), { target: { value: "  Annan person.  " } });
    fireEvent.click(save);
    expect(reviewed).toHaveBeenCalledWith({ id: M, note: "Annan person." });
    expect(invalidate.matter).toHaveBeenCalledWith({ id: M });
  });

  it("Avbryt stänger formuläret", () => {
    openForm();
    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(screen.queryByLabelText("Motivering")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bedöm träffarna" })).toBeInTheDocument();
  });

  it("serverns fel visas", () => {
    reviewError = { message: "Bara en advokat eller admin kan bedöma jävskontrollens träffar." };
    openForm();
    expect(screen.getByRole("alert")).toHaveTextContent(/advokat eller admin/);
  });

  it("en admin får också bedöma", () => {
    me = { id: "u1", role: "ADMIN" };
    render(<ConflictCheckActions matterId={M} hasHits />);
    expect(screen.getByRole("button", { name: "Bedöm träffarna" })).toBeInTheDocument();
  });

  it("en assistent ser varför bedömningen saknas", () => {
    me = { id: "u1", role: "ASSISTANT" };
    render(<ConflictCheckActions matterId={M} hasHits />);
    expect(screen.queryByRole("button", { name: "Bedöm träffarna" })).not.toBeInTheDocument();
    expect(screen.getByText("Bara en advokat eller admin kan bedöma träffarna.")).toBeInTheDocument();
  });

  it("okänd roll behandlas som utan behörighet", () => {
    me = { id: "u1", role: "GUEST" };
    render(<ConflictCheckActions matterId={M} hasHits />);
    expect(screen.queryByRole("button", { name: "Bedöm träffarna" })).not.toBeInTheDocument();
  });

  it("innan användaren laddats visas ingen bedömning", () => {
    me = undefined;
    render(<ConflictCheckActions matterId={M} hasHits />);
    expect(screen.queryByRole("button", { name: "Bedöm träffarna" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Bara en advokat/)).not.toBeInTheDocument();
  });

  it("omkörningsknappen är låst medan ett anrop pågår", () => {
    pending = true;
    render(<ConflictCheckActions matterId={M} hasHits />);
    expect(screen.getByRole("button", { name: "Kör jävskontrollen igen" })).toBeDisabled();
  });
});
