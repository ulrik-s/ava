/**
 * Jävskontrollens åtgärder i ärendet (#1246, #1354): kör om, och bedöm
 * träffarna med en motivering — bara advokat eller admin.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { ConflictCheckActions } from "@/components/watchlist/conflict-check-actions";
import { asId } from "@/lib/shared/schemas/ids";

const recheck = vi.fn();
const reviewed = vi.fn();
const invalidate = { watchlist: vi.fn(), actionItems: vi.fn(), matter: vi.fn() };
let pending = false;
let reviewError: { message: string } | null = null;
let me: { id: string; role: string } | undefined = { id: "u1", role: "LAWYER" };
/** Ärendet i `matter.getById`: listans träffar skickas med bedömningen (#1821). */
const HIT = { contactId: "c1", contactName: "Bertil Exempel", role: "MOTPART", matterId: "m-other", matterNumber: "2026-0042", matterTitle: "Tvist" };
let matterData: Record<string, unknown> | undefined;
/** Felet som servern ger; anropet går då till onError i stället för onSuccess. */
let failWith: { message: string } | null = null;
vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ watchlist: { list: { invalidate: invalidate.watchlist }, actionItems: { invalidate: invalidate.actionItems } }, matter: { getById: { invalidate: invalidate.matter } } }),
    user: { current: { useQuery: () => ({ data: me }) } },
    matter: {
      checkConflicts: { useMutation: (o: { onSuccess: () => void }) => ({ mutate: (a: unknown) => { recheck(a); o.onSuccess(); }, isPending: pending }) },
      getById: { useQuery: () => ({ data: matterData }) },
      markConflictsReviewed: {
        useMutation: (o: { onSuccess: () => void; onError: () => void }) => ({
          mutate: (a: unknown) => { reviewed(a); if (failWith) { reviewError = failWith; o.onError(); } else o.onSuccess(); },
          isPending: false, error: reviewError,
        }),
      },
    },
  },
}));

const M = asId<"MatterId">("m1");
beforeEach(() => {
  pending = false; reviewError = null; failWith = null; me = { id: "u1", role: "LAWYER" };
  matterData = { conflictCheckStatus: "HITS", conflictCheckResults: [HIT] };
  vi.clearAllMocks();
});

const openForm = (): void => {
  render(<ConflictCheckActions matterId={M} hasHits />);
  fireEvent.click(screen.getByRole("button", { name: "Bedöm träffarna" }));
};

describe("ConflictCheckActions", () => {
  it("kör om kontrollen och hämtar om ärendet, watchlist.list och actionItems", () => {
    render(<ConflictCheckActions matterId={M} hasHits={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Kör jävskontrollen igen" }));
    expect(recheck).toHaveBeenCalledWith({ id: M });
    expect(invalidate.watchlist).toHaveBeenCalled();
    expect(invalidate.actionItems).toHaveBeenCalled();
    expect(invalidate.matter).toHaveBeenCalledWith({ id: M });
  });

  it("utan träffar finns inget att bedöma och ingen länk till träffarna", () => {
    render(<ConflictCheckActions matterId={M} hasHits={false} />);
    expect(screen.queryByRole("button", { name: "Bedöm träffarna" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("med träffar: ingen länk till jävskontrollens historik (#1821)", () => {
    render(<ConflictCheckActions matterId={M} hasHits />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/Se träffarna/)).not.toBeInTheDocument();
  });

  it("bedömningen kräver en motivering, som skickas med listans träffar", () => {
    openForm();
    const save = screen.getByRole("button", { name: "Spara bedömning" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Motivering"), { target: { value: "  Annan person.  " } });
    fireEvent.click(save);
    expect(reviewed).toHaveBeenCalledWith({
      id: M, note: "Annan person.", hits: [{ contactId: "c1", matterId: "m-other", role: "MOTPART" }],
    });
    expect(invalidate.matter).toHaveBeenCalledWith({ id: M });
  });

  it("utan sparade träffar skickas en tom lista (#1821)", () => {
    matterData = { conflictCheckStatus: "HITS", conflictCheckResults: null };
    openForm();
    fireEvent.change(screen.getByLabelText("Motivering"), { target: { value: "Ok." } });
    fireEvent.click(screen.getByRole("button", { name: "Spara bedömning" }));
    expect(reviewed).toHaveBeenCalledWith({ id: M, note: "Ok.", hits: [] });
  });

  it("nekar servern visas beskedet i felraden och ärendet hämtas om (#1821)", () => {
    failWith = { message: "Kontrollen har gett nya träffar sedan du öppnade den. Bedöm igen." };
    openForm();
    fireEvent.change(screen.getByLabelText("Motivering"), { target: { value: "Ok." } });
    fireEvent.click(screen.getByRole("button", { name: "Spara bedömning" }));
    expect(invalidate.matter).toHaveBeenCalledWith({ id: M });
    expect(invalidate.watchlist).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Motivering"), { target: { value: "Ok igen." } });
    expect(screen.getByRole("alert")).toHaveTextContent("nya träffar sedan du öppnade den");
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
