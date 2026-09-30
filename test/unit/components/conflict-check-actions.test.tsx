/**
 * Jävskontrollens åtgärder i ärendet (#1246).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { ConflictCheckActions } from "@/components/watchlist/conflict-check-actions";
import { asId } from "@/lib/shared/schemas/ids";

const recheck = vi.fn();
const reviewed = vi.fn();
const invalidate = { watchlist: vi.fn(), matter: vi.fn() };
let pending = false;
vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ watchlist: { list: { invalidate: invalidate.watchlist } }, matter: { getById: { invalidate: invalidate.matter } } }),
    matter: {
      checkConflicts: { useMutation: (o: { onSuccess: () => void }) => ({ mutate: (a: unknown) => { recheck(a); o.onSuccess(); }, isPending: pending }) },
      markConflictsReviewed: { useMutation: (o: { onSuccess: () => void }) => ({ mutate: (a: unknown) => { reviewed(a); o.onSuccess(); }, isPending: false }) },
    },
  },
}));

const M = asId<"MatterId">("m1");
beforeEach(() => { pending = false; vi.clearAllMocks(); });

describe("ConflictCheckActions", () => {
  it("kör om kontrollen och uppdaterar ärendet och Att bevaka", () => {
    render(<ConflictCheckActions matterId={M} hasHits={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Kör jävskontrollen igen" }));
    expect(recheck).toHaveBeenCalledWith({ id: M });
    expect(invalidate.watchlist).toHaveBeenCalled();
    expect(invalidate.matter).toHaveBeenCalledWith({ id: M });
  });

  it("utan träffar finns inget att bedöma", () => {
    render(<ConflictCheckActions matterId={M} hasHits={false} />);
    expect(screen.queryByRole("button", { name: "Träffarna är bedömda" })).not.toBeInTheDocument();
  });

  it("med träffar går de att markera som bedömda", () => {
    render(<ConflictCheckActions matterId={M} hasHits />);
    fireEvent.click(screen.getByRole("button", { name: "Träffarna är bedömda" }));
    expect(reviewed).toHaveBeenCalledWith({ id: M });
  });

  it("knapparna är låsta medan ett anrop pågår", () => {
    pending = true;
    render(<ConflictCheckActions matterId={M} hasHits />);
    expect(screen.getByRole("button", { name: "Kör jävskontrollen igen" })).toBeDisabled();
  });
});
