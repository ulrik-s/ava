/**
 * Lasttestets invarianter (#1366): nummerserier, leverans, konvergens, idempotens.
 */
import { describe, expect, it } from "vitest-compat";
import {
  checkDelivery, checkSeries, diffViews, idempotencyViolations, project, seriesViolations,
} from "../../../../tooling/load/invariants";

describe("checkSeries", () => {
  it("en obruten serie håller", () => {
    expect(checkSeries(["F-2026-0002", "F-2026-0001", "F-2026-0003"])).toEqual([
      { prefix: "F-2026-", count: 3, duplicates: [], gaps: [], malformed: [] },
    ]);
  });

  it("hittar dubbletter och luckor, per prefix (år)", () => {
    const checks = checkSeries(["F-2026-0001", "F-2026-0001", "F-2026-0004", "F-2025-0001", "KR-2026-0002"]);
    expect(checks).toEqual([
      { prefix: "F-2025-", count: 1, duplicates: [], gaps: [], malformed: [] },
      { prefix: "F-2026-", count: 3, duplicates: ["F-2026-0001"], gaps: [2, 3], malformed: [] },
      { prefix: "KR-2026-", count: 1, duplicates: [], gaps: [1], malformed: [] },
    ]);
  });

  it("nummer i fel format rapporteras för sig", () => {
    expect(checkSeries(["abc"])).toEqual([{ prefix: "(ogiltigt format)", count: 1, duplicates: [], gaps: [], malformed: ["abc"] }]);
  });

  it("tom serie → inga kontroller", () => {
    expect(checkSeries([])).toEqual([]);
  });
});

describe("seriesViolations", () => {
  it("en rad per brott, luckor förkortade efter 20", () => {
    const gaps = Array.from({ length: 25 }, (_, i) => i + 1);
    const v = seriesViolations("faktura", [
      { prefix: "F-", count: 2, duplicates: ["F-1"], gaps, malformed: [] },
      { prefix: "(ogiltigt format)", count: 1, duplicates: [], gaps: [], malformed: ["x"] },
      { prefix: "G-", count: 1, duplicates: [], gaps: [], malformed: [] },
    ]);
    expect(v).toHaveLength(3);
    expect(v[0]).toBe("faktura F-: dubbla nummer F-1");
    expect(v[1]).toMatch(/luckor 1, 2, .* 20 …$/);
    expect(v[2]).toBe("faktura: nummer i fel format x");
  });

  it("utan luckutfyllnad när de är få", () => {
    expect(seriesViolations("x", [{ prefix: "P-", count: 1, duplicates: [], gaps: [2], malformed: [] }])).toEqual(["x P-: luckor 2"]);
  });
});

describe("checkDelivery", () => {
  it("allt levererat exakt en gång", () => {
    expect(checkDelivery(["a", "b", "a"], ["b", "a"])).toEqual({ expected: 2, found: 2, missing: [], duplicated: {} });
  });

  it("förlorat och dubblerat", () => {
    expect(checkDelivery(["a", "b", "c"], ["a", "a", "c"])).toEqual({ expected: 3, found: 2, missing: ["b"], duplicated: { a: 2 } });
  });
});

describe("project + diffViews", () => {
  it("projicerar fält, normaliserar och sorterar på id", () => {
    const d = new Date("2026-10-01T00:00:00.000Z");
    expect(project([{ id: "b", n: 1, x: "no" }, { id: "a", n: undefined, at: d, j: { k: 1 }, ok: true }], ["id", "n", "at", "j", "ok"])).toEqual([
      { id: "a", n: null, at: "2026-10-01T00:00:00.000Z", j: "{\"k\":1}", ok: true },
      { id: "b", n: 1, at: null, j: null, ok: null },
    ]);
  });

  it("samma vy → inga avvikelser", () => {
    expect(diffViews("t", [{ id: "a", v: 1 }], [{ id: "a", v: 1 }])).toEqual([]);
  });

  it("saknade, extra och skilda rader", () => {
    const out = diffViews("t", [{ id: "a", v: 1 }, { id: "c", v: 1 }], [{ id: "a", v: 2 }, { id: "b", v: 1 }]);
    expect(out).toEqual([
      "t: 1 rader finns på servern men inte hos klienten",
      "t: 1 rader finns hos klienten men inte på servern",
      "t: 1 rader skiljer sig (t.ex. klient {\"id\":\"a\",\"v\":1}, server {\"id\":\"a\",\"v\":2})",
    ]);
  });
});

describe("idempotencyViolations", () => {
  it("en rad, ett utfall, alla accepterade → inget brott", () => {
    expect(idempotencyViolations([
      { mutationId: "m", statuses: ["accepted", "accepted", "rebased"], rowCount: 1, storedOutcomes: 1 },
      { mutationId: "r", statuses: ["accepted"], rowCount: 1, storedOutcomes: null },
    ])).toEqual([]);
  });

  it("dubbla rader, flera sparade utfall och fel rapporteras", () => {
    expect(idempotencyViolations([
      { mutationId: "m", statuses: ["accepted", "fel 500:INTERNAL_SERVER_ERROR", "fel 500:INTERNAL_SERVER_ERROR"], rowCount: 2, storedOutcomes: 0 },
    ])).toEqual([
      "m: 2 rader i st.f. 1",
      "m: 0 sparade utfall i st.f. 1",
      "m: 2 av 3 flikar fick fel 500:INTERNAL_SERVER_ERROR",
    ]);
  });
});
