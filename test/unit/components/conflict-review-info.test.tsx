/**
 * Jävskontrollens dokumenterade bedömning i ärendet (#1354): vem, när, varför.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { ConflictReviewInfo } from "@/components/watchlist/conflict-review-info";
import { asId } from "@/lib/shared/schemas/ids";

let matter: Record<string, unknown> | undefined;
let users: Array<{ id: string; name: string }> | undefined;
vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    matter: { getById: { useQuery: () => ({ data: matter }) } },
    user: { list: { useQuery: () => ({ data: users ? { users } : undefined }) } },
  },
}));

const M = asId<"MatterId">("m1");
const REVIEW = {
  conflictCheckStatus: "REVIEWED",
  conflictReviewedById: "u-anna",
  conflictReviewedAt: "2026-10-01T12:05:00.000Z",
  conflictReviewNote: "Samma namn, annan person.",
};
beforeEach(() => { matter = { ...REVIEW }; users = [{ id: "u-anna", name: "Anna Advokat" }]; });

describe("ConflictReviewInfo", () => {
  it("visar granskaren, tidpunkten (svensk tid) och motiveringen", () => {
    render(<ConflictReviewInfo matterId={M} />);
    const note = screen.getByRole("note", { name: "Jävskontrollens bedömning" });
    expect(note).toHaveTextContent("Jävskontrollen bedömd av Anna Advokat 2026-10-01 14:05");
    expect(note).toHaveTextContent("Samma namn, annan person.");
  });

  it("efter nya träffar står bedömningen kvar som den senaste", () => {
    matter = { ...REVIEW, conflictCheckStatus: "HITS" };
    render(<ConflictReviewInfo matterId={M} />);
    expect(screen.getByRole("note")).toHaveTextContent("Senaste bedömningen av jävskontrollen av Anna Advokat");
  });

  it("okänd granskare (t.ex. borttagen användare, eller listan inte laddad)", () => {
    users = undefined;
    render(<ConflictReviewInfo matterId={M} />);
    expect(screen.getByRole("note")).toHaveTextContent("av okänd användare");
  });

  it("utan bedömning visas ingenting", () => {
    matter = { conflictCheckStatus: "HITS" };
    const { container } = render(<ConflictReviewInfo matterId={M} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("innan ärendet laddats visas ingenting", () => {
    matter = undefined;
    const { container } = render(<ConflictReviewInfo matterId={M} />);
    expect(container).toBeEmptyDOMElement();
  });
});
