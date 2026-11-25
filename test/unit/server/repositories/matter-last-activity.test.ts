/**
 * "Senast hänt" i ett ärende (#1967): minnesrepots rena logik. Samma ordning
 * prövas mot båda backends i `repository-list-contract.test.ts`.
 */

import { describe, expect, it } from "vitest-compat";
import { compareLastActivity, lastActivityByMatter } from "@/lib/server/repositories/matter-last-activity";
import { asId } from "@/lib/shared/schemas/ids";

const m1 = asId<"MatterId">("m1");
const m2 = asId<"MatterId">("m2");
const t = (iso: string): number => new Date(iso).getTime();

describe("lastActivityByMatter", () => {
  it("senaste updatedAt per ärende, som Date eller ISO-sträng", () => {
    const out = lastActivityByMatter([
      { matterId: "m1", updatedAt: new Date("2026-01-01T00:00:00Z") },
      { matterId: "m1", updatedAt: "2026-02-01T00:00:00.000Z" },
      { matterId: "m2", updatedAt: "2026-01-15T00:00:00.000Z" },
    ], [m1, m2]);
    expect(Object.fromEntries(out)).toEqual({ m1: t("2026-02-01T00:00:00Z"), m2: t("2026-01-15T00:00:00Z") });
  });

  it("hoppar över raderade rader och rader för andra ärenden; ett ärende utan poster saknas", () => {
    const out = lastActivityByMatter([
      { matterId: "m1", updatedAt: "2026-03-01T00:00:00Z", deletedAt: "2026-03-02T00:00:00Z" },
      { matterId: "m1", updatedAt: "2026-01-01T00:00:00Z", deletedAt: null },
      { matterId: "annat", updatedAt: "2026-05-01T00:00:00Z" },
    ], [m1, m2]);
    expect(Object.fromEntries(out)).toEqual({ m1: t("2026-01-01T00:00:00Z") });
  });

  it("en rad utan updatedAt räknas som tid 0", () => {
    expect(lastActivityByMatter([{ matterId: "m1", updatedAt: null }], [m1]).get("m1")).toBe(0);
  });
});

describe("compareLastActivity", () => {
  const sorted = (activity: Map<string, number>, matters: Array<{ id: string; createdAt?: string | null }>): string[] =>
    [...matters].sort(compareLastActivity(activity)).map((m) => m.id);

  it("senast hänt fallande; ett ärende utan poster räknas på createdAt", () => {
    const activity = new Map([["a", t("2026-03-01T00:00:00Z")]]);
    expect(sorted(activity, [
      { id: "a", createdAt: "2026-01-01T00:00:00Z" },
      { id: "b", createdAt: "2026-04-01T00:00:00Z" },
      { id: "c", createdAt: "2026-02-01T00:00:00Z" },
    ])).toEqual(["b", "a", "c"]);
  });

  it("lika tid: nyast skapade först, sedan id fallande bytevis", () => {
    const same = t("2026-03-01T00:00:00Z");
    const activity = new Map([["a", same], ["b", same], ["c", same], ["d", same]]);
    expect(sorted(activity, [
      { id: "a", createdAt: "2026-01-01T00:00:00Z" },
      { id: "b", createdAt: "2026-02-01T00:00:00Z" },
      { id: "d", createdAt: "2026-01-01T00:00:00Z" },
      { id: "c", createdAt: "2026-01-01T00:00:00Z" },
    ])).toEqual(["b", "d", "c", "a"]);
  });

  it("samma id jämförs lika; saknad createdAt räknas som 0", () => {
    const cmp = compareLastActivity(new Map());
    expect(cmp({ id: "x" }, { id: "x", createdAt: null })).toBe(0);
  });
});
