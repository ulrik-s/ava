/**
 * Jävskontrollen i Att bevaka (#1246): ett ärende vars kontroll väntar eller
 * har träffar är en bevakning tills kontrollen är klar.
 */
import { describe, expect, it } from "vitest-compat";
import { conflictCheckItems } from "@/lib/shared/watchlist";

const M = { id: "m-1", matterNumber: "2026-0007" };

describe("conflictCheckItems", () => {
  it("träffar → passerad post med antalet, som leder till ärendet", () => {
    expect(conflictCheckItems([{ ...M, conflictCheckStatus: "HITS", conflictCheckHits: 2 }])).toEqual([{
      kind: "conflictCheck", severity: "passed", title: "Jävskontroll: 2 träffar att bedöma",
      detail: "Klienten förekommer i byråns andra ärenden. Bedöm träffarna innan uppdraget tas.",
      matterId: "m-1", matterNumber: "2026-0007", at: null, amountOre: null, link: { route: "matters", id: "m-1" },
    }]);
  });

  it("väntar → annalkande post", () => {
    const [item] = conflictCheckItems([{ ...M, conflictCheckStatus: "PENDING" }]);
    expect(item).toMatchObject({ severity: "approaching", title: "Jävskontroll väntar" });
  });

  it("träffar utan antal visar 0", () => {
    expect(conflictCheckItems([{ ...M, conflictCheckStatus: "HITS" }])[0]?.title).toBe("Jävskontroll: 0 träffar att bedöma");
  });

  it("klar, bedömd, äldre ärenden utan status och stängda ärenden ger ingen post", () => {
    expect(conflictCheckItems([
      { ...M, conflictCheckStatus: "CLEAR" },
      { ...M, conflictCheckStatus: "REVIEWED" },
      { ...M },
      { ...M, status: "CLOSED", conflictCheckStatus: "HITS" },
      { ...M, status: "ARCHIVED", conflictCheckStatus: "PENDING" },
    ])).toEqual([]);
  });
});
