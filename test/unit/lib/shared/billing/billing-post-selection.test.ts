/**
 * Tester för postsInDateRange (#1888): fakturans poster väljs på svensk
 * kalenderdag (#1677), med båda gränserna inklusive och tomma fält öppna.
 */

import { describe, it, expect } from "vitest-compat";
import { postsInDateRange } from "@/lib/shared/billing/billing-post-selection";

const rows = [
  { id: "a", date: "2026-03-01" },
  { id: "b", date: new Date("2026-03-10T12:00:00Z") },
  { id: "c", date: "2026-03-20" },
];
const ids = (from: string, to: string): string[] => postsInDateRange(rows, from, to).map((r) => r.id);

describe("postsInDateRange", () => {
  it("båda gränserna ingår", () => {
    expect(ids("2026-03-01", "2026-03-10")).toEqual(["a", "b"]);
    expect(ids("2026-03-10", "2026-03-20")).toEqual(["b", "c"]);
  });

  it("ett tomt fält är öppet åt det hållet", () => {
    expect(ids("", "2026-03-10")).toEqual(["a", "b"]);
    expect(ids("2026-03-11", "")).toEqual(["c"]);
  });

  it("båda tomma ger alla poster", () => {
    expect(ids("", "")).toEqual(["a", "b", "c"]);
  });

  it("en post 23:30 UTC hamnar på nästa svenska dag", () => {
    const late = [{ id: "x", date: new Date("2026-03-01T23:30:00Z") }];
    expect(postsInDateRange(late, "2026-03-01", "2026-03-01")).toEqual([]);
    expect(postsInDateRange(late, "2026-03-02", "2026-03-02").map((r) => r.id)).toEqual(["x"]);
  });
});
