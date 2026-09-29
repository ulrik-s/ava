/**
 * `admitProcedure` / `admitRow` (#1247) — servern tar emot, migrerar eller
 * avvisar en köpost efter formatet den skrevs i.
 */
import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest-compat";
import type { QueuedMutation, QueuedProcedureCall } from "@/lib/server/data-store/in-memory/mutation-queue";
import { admitProcedure, admitRow } from "@/lib/server/sync/queue-admission";
import type { QueuePolicy } from "@/lib/shared/sync/queue-format";

const call = (format?: number): QueuedProcedureCall => ({
  type: "procedure", mutationId: "m", path: "timeEntry.create", input: { hours: 1 }, codeVersion: "v", touches: [], enqueuedAt: 0,
  ...(format !== undefined ? { format } : {}),
});
const row = (format?: number): QueuedMutation => ({
  mutationId: "r", entity: "timeEntry", kind: "update", row: { id: "t", hours: 1 }, enqueuedAt: 0,
  ...(format !== undefined ? { format } : {}),
});

/** Format 2 är dagens; format 1 migreras (timmar → minuter); äldre avvisas. */
const policy: QueuePolicy = {
  current: 2, min: 1,
  migrations: {
    1: (p) => ({
      ...p,
      ...(p.input ? { input: { minutes: Number(p.input.hours) * 60 } } : {}),
      ...(p.row ? { row: { id: p.row.id, minutes: Number(p.row.hours) * 60 } } : {}),
    }),
  },
};

describe("köformatet på servern", () => {
  it("dagens format körs som det är", () => {
    const c = call(2);
    expect(admitProcedure(c, policy)).toEqual({ kind: "run", entry: c });
    const r = row(2);
    expect(admitRow(r, policy)).toEqual({ kind: "run", entry: r });
  });

  it("ett äldre, stött format migreras och stämplas med dagens", () => {
    expect(admitProcedure(call(1), policy)).toMatchObject({ kind: "run", entry: { path: "timeEntry.create", input: { minutes: 60 }, format: 2 } });
    expect(admitRow(row(1), policy)).toMatchObject({ kind: "run", entry: { entity: "timeEntry", row: { id: "t", minutes: 60 }, format: 2 } });
  });

  it("en ostämplad post (före #1247) räknas som format 1", () => {
    expect(admitProcedure(call(), policy)).toMatchObject({ kind: "run", entry: { input: { minutes: 60 } } });
  });

  it("för gammalt → avvisad med ett tydligt besked", () => {
    const strict: QueuePolicy = { ...policy, min: 2 };
    expect(admitProcedure(call(1), strict)).toEqual({ kind: "reject", reason: expect.stringMatching(/för gammal version av AVA/) });
    expect(admitRow(row(1), strict)).toMatchObject({ kind: "reject" });
  });

  it("nyare än servern → tekniskt fel (klienten försöker igen), aldrig ett utfall", () => {
    let thrown: unknown;
    try { admitProcedure(call(3), policy); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(TRPCError);
    expect(thrown).toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(() => admitRow(row(3), policy)).toThrow(/Servern kör en äldre version/);
  });

  it("dagens policy tar emot det klienten skriver", () => {
    expect(admitProcedure(call(1)).kind).toBe("run");
  });
});
