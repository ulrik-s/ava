/**
 * Jävskontrollens träffar i ärendets flik Parter (#1821): en rad per träff med
 * kontakten, rollen och det andra ärendet som länk via `__shell__`.
 */
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { ConflictHitList } from "@/components/watchlist/conflict-hit-list";
import { asId } from "@/lib/shared/schemas/ids";

let matter: Record<string, unknown> | undefined;
vi.mock("@/lib/client/trpc", () => ({
  trpc: { matter: { getById: { useQuery: () => ({ data: matter }) } } },
}));

const M = asId<"MatterId">("m1");
const HITS = [
  { contactId: "c1", contactName: "Bertil Exempel", role: "MOTPART", matterId: "m-other", matterNumber: "2026-0042", matterTitle: "Tvist om staket" },
  { contactId: "c2", contactName: "Cecilia Prov", role: "KLIENT", matterId: "m-third", matterNumber: "2026-0043", matterTitle: "Arvskifte" },
];
beforeEach(() => { matter = { conflictCheckStatus: "HITS", conflictCheckResults: HITS }; });

describe("ConflictHitList", () => {
  it("visar en rad per träff med namn, roll och det andra ärendet som länk", () => {
    render(<ConflictHitList matterId={M} />);
    expect(screen.getByText("Träffar i senaste kontrollen")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    const first = rows[0];
    if (!first) throw new Error("raden saknas");
    expect(first).toHaveTextContent("Bertil Exempel (Motpart) i 2026-0042 — Tvist om staket");
    // EntityLink via den förrenderade __shell__-routen: fungerar för ärenden skapade efter bygget.
    const link = within(first).getByRole("link", { name: "2026-0042 — Tvist om staket" });
    expect(link.getAttribute("href")).toBe("/matters/__shell__?id=m-other");
  });

  it("visar träffarna också när de är bedömda", () => {
    matter = { conflictCheckStatus: "REVIEWED", conflictCheckResults: HITS };
    render(<ConflictHitList matterId={M} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("ingen lista när kontrollen saknar träffar", () => {
    matter = { conflictCheckStatus: "HITS", conflictCheckResults: [] };
    const { container } = render(<ConflictHitList matterId={M} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("ingen lista för en klar kontroll eller ett ärende som inte laddats", () => {
    matter = { conflictCheckStatus: "CLEAR", conflictCheckResults: HITS };
    const { container, rerender } = render(<ConflictHitList matterId={M} />);
    expect(container).toBeEmptyDOMElement();
    matter = undefined;
    rerender(<ConflictHitList matterId={M} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("bedömt ärende utan sparade träffar: ingen lista och ingen uppmaning", () => {
    matter = { conflictCheckStatus: "REVIEWED", conflictCheckResults: null };
    const { container } = render(<ConflictHitList matterId={M} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("äldre ärende med träffar att bedöma men utan sparade träffar: uppmaning att köra igen", () => {
    matter = { conflictCheckStatus: "HITS", conflictCheckResults: null };
    render(<ConflictHitList matterId={M} className="mt-4" />);
    const text = screen.getByText("Kör jävskontrollen igen för att se träffarna.");
    expect(text).toHaveClass("mt-4");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
