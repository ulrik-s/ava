/**
 * `CachingSyncDataStore.runQueuedProcedure` (#1265, ADR 0037).
 *
 * En köbar procedur körs lokalt som förut (fungerar offline), men raderna den
 * skriver köas INTE som rader: kön får EN post med anropet och vilka rader det
 * berörde. Misslyckas proceduren lokalt rullas dess skrivningar tillbaka och
 * ingenting köas.
 */
import { describe, expect, it } from "vitest-compat";
import { CachingSyncDataStore, noSyncTransport } from "@/lib/server/data-store/in-memory/caching-sync-data-store";
import { InMemoryPersistence } from "@/lib/server/data-store/in-memory/local-store-persistence";
import { isProcedureCall } from "@/lib/server/data-store/in-memory/mutation-queue";
import { uuidv7 } from "@/lib/shared/uuid";

const entry = (id: string) => ({ id, matterId: uuidv7(), userId: uuidv7(), date: new Date(), minutes: 30, description: "Samtal", hourlyRate: 1500 });

async function store() {
  return CachingSyncDataStore.create({ transport: noSyncTransport });
}

describe("runQueuedProcedure", () => {
  it("köar ETT anrop med berörda rader — inga radposter", async () => {
    const ds = await store();
    const id = uuidv7();
    const result = await ds.runQueuedProcedure({ path: "timeEntry.create", input: { id } }, async () => {
      await ds.store.timeEntries.create({ data: entry(id) as never });
      return "ok";
    });
    expect(result).toBe("ok");
    expect(ds.pendingCount()).toBe(1);
    const [item] = ds.pendingEntries();
    expect(item && isProcedureCall(item)).toBe(true);
    expect(item).toMatchObject({ path: "timeEntry.create", input: { id }, touches: [{ entity: "timeEntry", id }] });
    // Den lokala raden finns — offline fungerar som förut.
    expect(await ds.store.timeEntries.findUnique({ where: { id } })).toMatchObject({ id });
  });

  it("körningen får anropets identitet — samma mutationId och tid som köas (#1276)", async () => {
    const ds = await store();
    let seen: { mutationId: string; at: number } | undefined;
    await ds.runQueuedProcedure({ path: "timeEntry.create", input: {} }, async (queued) => { seen = queued; });
    const [item] = ds.pendingEntries();
    expect(seen).toBeDefined();
    expect(item).toMatchObject({ mutationId: seen?.mutationId, enqueuedAt: seen?.at });
  });

  it("en rad som berörs flera gånger står bara en gång i touches", async () => {
    const ds = await store();
    const id = uuidv7();
    await ds.runQueuedProcedure({ path: "timeEntry.create", input: { id } }, async () => {
      await ds.store.timeEntries.create({ data: entry(id) as never });
      await ds.store.timeEntries.update({ where: { id }, data: { minutes: 45 } as never });
    });
    expect(ds.pendingEntries()[0]).toMatchObject({ touches: [{ entity: "timeEntry", id }] });
  });

  it("proceduren kastar → dess lokala skrivningar rullas tillbaka och inget köas", async () => {
    const ds = await store();
    const id = uuidv7();
    await expect(ds.runQueuedProcedure({ path: "timeEntry.create", input: { id } }, async () => {
      await ds.store.timeEntries.create({ data: entry(id) as never });
      throw new Error("PRECONDITION_FAILED");
    })).rejects.toThrow("PRECONDITION_FAILED");
    expect(ds.pendingCount()).toBe(0);
    expect(await ds.store.timeEntries.findUnique({ where: { id } })).toBeNull();
  });

  it("lyssnarna på lokala ändringar får EN signal per anrop", async () => {
    const ds = await store();
    let signals = 0;
    ds.onLocalChange(() => { signals++; });
    await ds.runQueuedProcedure({ path: "timeEntry.create", input: {} }, async () => {
      await ds.store.timeEntries.create({ data: entry(uuidv7()) as never });
      await ds.store.timeEntries.create({ data: entry(uuidv7()) as never });
    });
    expect(signals).toBe(1);
  });

  it("vanliga mutationer utanför ett anrop köas fortfarande som rader", async () => {
    const ds = await store();
    await ds.store.timeEntries.create({ data: entry(uuidv7()) as never });
    expect(ds.pendingEntries()[0] && isProcedureCall(ds.pendingEntries()[0]!)).toBe(false);
  });

  it("en avvisad omkörning: serverns tombstone tar bort den lokala raden — även i det persisterade snapshotet", async () => {
    const persistence = new InMemoryPersistence();
    const ds = await CachingSyncDataStore.create({
      transport: {
        ...noSyncTransport,
        pushProcedure: async (c) => ({
          status: "rejected", code: "NOT_FOUND", reason: "Finns inte",
          rows: c.touches.map((t) => ({ entity: t.entity, row: { id: t.id }, deleted: true })),
        }),
      },
      persistence,
    });
    const id = uuidv7();
    await ds.runQueuedProcedure({ path: "timeEntry.update", input: { id } }, async () => {
      await ds.store.timeEntries.create({ data: entry(id) as never });
    });
    const res = await ds.reconcile();
    expect(res.conflicts).toHaveLength(1);
    expect(await ds.store.timeEntries.findUnique({ where: { id } })).toBeNull();
    expect((await persistence.hydrate())?.timeEntries ?? []).toHaveLength(0);
  });

  it("hasPendingFor: rader och procedur-anropens touches räknas; ackade inte", async () => {
    const ds = await store();
    const t = uuidv7(), c = uuidv7();
    await ds.runQueuedProcedure({ path: "timeEntry.create", input: { id: t } }, async () => {
      await ds.store.timeEntries.create({ data: entry(t) as never });
    });
    await ds.store.contacts.create({ data: { id: c, organizationId: uuidv7(), name: "K", contactType: "PERSON" } as never });
    expect(ds.hasPendingFor("timeEntry", t)).toBe(true);
    expect(ds.hasPendingFor("contact", c)).toBe(true);
    expect(ds.hasPendingFor("invoice", t)).toBe(false);
    await ds.reconcile();
    expect(ds.hasPendingFor("timeEntry", t)).toBe(false);
    expect(ds.hasPendingFor("contact", c)).toBe(false);
  });

  // #1266: avvisningar sparas, och ett nytt försök köas på nytt.
  it("en avvisning i reconcile lämnas till onConflicts — den glöms inte", async () => {
    const seen: unknown[] = [];
    const transport = {
      ...noSyncTransport,
      pushProcedure: async () => ({ status: "rejected" as const, code: "PRECONDITION_FAILED", reason: "Posterna är redan fakturerade.", rows: [] }),
    };
    const ds = await CachingSyncDataStore.create({ transport, onConflicts: async (c) => { seen.push(...c); } });
    await ds.runQueuedProcedure({ path: "timeEntry.create", input: {} }, async () => {});
    await ds.reconcile();
    expect(seen).toMatchObject([{ reason: "Posterna är redan fakturerade.", mutation: { path: "timeEntry.create" } }]);
  });

  it("requeue: ett anrop köas med NYTT mutationId; en rad byggs på serverns version", async () => {
    const ds = await store();
    const call = { type: "procedure" as const, mutationId: "gammal", path: "timeEntry.update", input: { id: "t" }, codeVersion: "v", touches: [], enqueuedAt: 0 };
    await ds.requeue(call);
    const row = { mutationId: "r", entity: "invoice", kind: "update" as const, row: { id: "i1" }, baseVersion: 2, enqueuedAt: 0 };
    await ds.requeue(row, { id: "i1", version: 5 });
    await ds.requeue({ ...row, mutationId: "r2", row: { id: "i2" } });
    const [again, rowAgain, rowFallback] = ds.pendingEntries();
    expect(again).toMatchObject({ path: "timeEntry.update", input: { id: "t" } });
    expect(again?.mutationId).not.toBe("gammal");
    expect(rowAgain).toMatchObject({ entity: "invoice", row: { id: "i1" }, baseVersion: 5 });
    expect(rowFallback).toMatchObject({ row: { id: "i2" }, baseVersion: 2 });
  });
});
