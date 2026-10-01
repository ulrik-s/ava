/**
 * `canonical-restore` (#1348) — byggstenarna för att återställa rader efter en
 * avvisad ändring: vilka rader en köpost rörde, hämtning i portioner, och
 * planen som håller reda på vad som redan har serverns läge.
 */
import { describe, expect, it } from "vitest-compat";
import { fetchCanonical, pendingKeysOf, refsOf, RestorePlan } from "@/lib/server/data-store/in-memory/canonical-restore";
import type { QueueEntry } from "@/lib/server/data-store/in-memory/mutation-queue";
import { MAX_ROW_REFS, type PulledChange, type RowRef } from "@/lib/server/data-store/in-memory/sync-transport";

const tombstones = async (refs: readonly RowRef[]): Promise<PulledChange[]> =>
  refs.map((r) => ({ entity: r.entity, row: { id: r.id }, deleted: true }));

describe("refsOf / pendingKeysOf", () => {
  it("en radpost rör sin rad (ett id som inte är en sträng blir tomt); ett anrop sina touches", () => {
    const row: QueueEntry = { mutationId: "a", entity: "task", kind: "create", row: { id: "t1" }, enqueuedAt: 0 };
    const odd: QueueEntry = { mutationId: "b", entity: "task", kind: "create", row: { id: 7 }, enqueuedAt: 0 };
    const call: QueueEntry = { type: "procedure", mutationId: "p", path: "x.y", input: {}, codeVersion: "v", touches: [{ entity: "matter", id: "m1" }], enqueuedAt: 0 };
    expect(refsOf(row)).toEqual([{ entity: "task", id: "t1" }]);
    expect(refsOf(odd)).toEqual([{ entity: "task", id: "" }]);
    expect([...pendingKeysOf([row, call])]).toEqual(["task:t1", "matter:m1"]);
  });
});

describe("fetchCanonical", () => {
  it("frågar högst MAX_ROW_REFS rader åt gången, i ordning", async () => {
    const sizes: number[] = [];
    const refs = Array.from({ length: MAX_ROW_REFS + 1 }, (_, i) => ({ entity: "task", id: `t${i}` }));
    const changes = await fetchCanonical({ rows: (r) => { sizes.push(r.length); return tombstones(r); } }, refs);
    expect(sizes).toEqual([MAX_ROW_REFS, 1]);
    expect(changes.map((c) => c.row.id)).toEqual(refs.map((r) => r.id));
  });

  it("inga rader → inget anrop", async () => {
    let calls = 0;
    expect(await fetchCanonical({ rows: (r) => { calls++; return tombstones(r); } }, [])).toEqual([]);
    expect(calls).toBe(0);
  });
});

describe("RestorePlan", () => {
  it("know ersätter want och tvärtom; settled stryker båda; kvarvarande köposter hoppas", async () => {
    const plan = new RestorePlan([{ entity: "task", id: "carried" }]);
    plan.want({ entity: "task", id: "a" });
    plan.know({ entity: "task", row: { id: "a", v: 1 } }); // läget följde med — hämtas inte
    plan.know({ entity: "task", row: { id: "b", v: 1 } });
    plan.want({ entity: "task", id: "b" }); // senare avvisning utan läge — hämtas
    plan.want({ entity: "task", id: "c" });
    plan.settled({ entity: "task", id: "c" });
    plan.want({ entity: "task", id: "pending" });
    const applied: string[] = [];
    const requested: string[] = [];
    const out = await plan.run(
      new Set(["task:pending"]),
      { rows: (refs) => { requested.push(...refs.map((r) => r.id)); return tombstones(refs); } },
      (entity, row, deleted) => { applied.push(`${String(row.id)}${deleted ? "-" : "+"}`); },
    );
    expect(requested).toEqual(["carried", "b"]);
    expect(applied).toEqual(["a+", "carried-", "b-"]);
    expect(out).toEqual({ restored: 3, unrestored: [] });
  });

  it("hämtningen misslyckas → det kända skrivs ändå; resten kommer i unrestored", async () => {
    const plan = new RestorePlan();
    plan.know({ entity: "task", row: { id: "a" } });
    plan.want({ entity: "task", id: "b" });
    const applied: string[] = [];
    const out = await plan.run(new Set(), { rows: () => Promise.reject(new Error("offline")) }, (_e, row) => { applied.push(String(row.id)); });
    expect(applied).toEqual(["a"]);
    expect(out).toEqual({ restored: 1, unrestored: [{ entity: "task", id: "b" }] });
  });
});
