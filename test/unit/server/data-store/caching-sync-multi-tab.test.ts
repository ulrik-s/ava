/**
 * Snapshotet med flera flikar (#1714, ADR 0037) — varje flik har en egen
 * `CachingSyncDataStore` över samma IndexedDB (snapshot + kö). Alla flikar
 * delar ett snapshot, och sista skrivningen vinner:
 *
 *   1. en fliks snapshot får aldrig tappa en rad som en annan flik har köat,
 *   2. och aldrig behålla provisoriska rader vars köpost redan är avgjord.
 */

import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest-compat";
import { CachingSyncDataStore } from "@/lib/server/data-store/in-memory/caching-sync-data-store";
import { InMemoryCursorStore } from "@/lib/server/data-store/in-memory/cursor-store";
import { IndexedDbPersistence } from "@/lib/server/data-store/in-memory/indexeddb-persistence";
import { IndexedDbMutationQueuePersistence } from "@/lib/server/data-store/in-memory/mutation-queue";
import type { PulledChange, SyncTransport } from "@/lib/server/data-store/in-memory/sync-transport";
import { uuidv7 } from "@/lib/shared/uuid";
import { changeChannelHub, settle } from "../../../helpers/change-channel-hub";

const entry = (id: string, minutes = 30) => ({ id, matterId: uuidv7(), userId: uuidv7(), date: new Date(), minutes, description: "Samtal", hourlyRate: 1500 });

/** En server i minnet: en ändringslogg, radernas läge, och serverns egna id:n för procedur-anrop. */
function fakeServer() {
  const rows = new Map<string, PulledChange>();
  const log: PulledChange[] = [];
  const created: string[] = [];
  const write = (entity: string, row: Record<string, unknown>, deleted: boolean): void => {
    const change: PulledChange = deleted ? { entity, row, deleted } : { entity, row };
    rows.set(`${entity}:${String(row.id)}`, change);
    log.push(change);
  };
  const canonical = (ref: { entity: string; id: string }): PulledChange =>
    rows.get(`${ref.entity}:${ref.id}`) ?? { entity: ref.entity, row: { id: ref.id }, deleted: true };
  const transport: SyncTransport = {
    pull: (since) => Promise.resolve({ changes: log.slice(since), cursor: log.length }),
    rows: (refs) => Promise.resolve(refs.map(canonical)),
    push: (m) => {
      write(m.entity, m.row, m.kind === "delete");
      return Promise.resolve({ status: "accepted", row: m.row });
    },
    // Servern kör om anropet och skapar raden med ETT EGET id; klientens
    // provisoriska rad finns inte hos servern (tombstone).
    pushProcedure: (call) => {
      const id = uuidv7();
      created.push(id);
      write("timeEntry", entry(id), false);
      return Promise.resolve({ status: "accepted", rows: call.touches.map(canonical) });
    },
  };
  return { transport, created };
}

/** En webbläsarprofil: flikarna delar snapshot och kö. */
function browser(transport: SyncTransport, channels?: ReturnType<typeof changeChannelHub>) {
  const factory = new IDBFactory();
  return async function openTab(own: SyncTransport = transport): Promise<CachingSyncDataStore> {
    const cursor = new InMemoryCursorStore();
    return CachingSyncDataStore.create({
      transport: own,
      cursor,
      persistence: new IndexedDbPersistence(factory, "tabs-source", undefined, cursor),
      queuePersistence: new IndexedDbMutationQueuePersistence(factory, "tabs-queue", channels?.()),
    });
  };
}

/** Samma server, men varje `pull` väntar tills `release` anropas. */
function heldPull(transport: SyncTransport): { transport: SyncTransport; release: () => void } {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return { transport: { ...transport, pull: (since, epoch) => gate.then(() => transport.pull(since, epoch)) }, release };
}

const ids = async (tab: CachingSyncDataStore): Promise<string[]> =>
  (await tab.store.timeEntries.findMany({})).map((row) => row.id).sort();

describe("snapshotet tappar aldrig en köad rad (#1714, fel 1)", () => {
  it("A skapar X, B sparar en annan ändring → en ny flik ser X, med den köade ändringen", async () => {
    const openTab = browser(fakeServer().transport);
    const a = await openTab();
    const b = await openTab();
    const x = uuidv7();
    const y = uuidv7();
    await a.store.timeEntries.create({ data: entry(x) as never });
    await a.store.timeEntries.update({ where: { id: x }, data: { minutes: 45 } });
    // B känner inte till X (har inte läst om kön) och sparar hela sitt snapshot.
    await b.store.timeEntries.create({ data: entry(y) as never });

    const fresh = await openTab();
    expect(await ids(fresh)).toEqual([x, y].sort());
    expect(await fresh.store.timeEntries.findUnique({ where: { id: x } })).toMatchObject({ minutes: 45 });
    expect(fresh.pendingCount()).toBe(3);
  });

  it("raderna från en annan fliks köade procedur-anrop bärs också över", async () => {
    const openTab = browser(fakeServer().transport);
    const a = await openTab();
    const b = await openTab();
    const p = uuidv7();
    await a.runQueuedProcedure({ path: "timeEntry.create", input: { id: p } }, async () => {
      await a.store.timeEntries.create({ data: entry(p) as never });
    });
    await b.store.timeEntries.create({ data: entry(uuidv7()) as never });
    await b.store.timeEntries.create({ data: entry(uuidv7()) as never });

    const fresh = await openTab();
    expect(await fresh.store.timeEntries.findUnique({ where: { id: p } })).toMatchObject({ id: p });
    expect(await ids(fresh)).toHaveLength(3);
  });

  it("en rad som en annan flik har köat en radering av står inte kvar i snapshotet", async () => {
    const openTab = browser(fakeServer().transport);
    const seedTab = await openTab();
    const x = uuidv7();
    await seedTab.store.timeEntries.create({ data: entry(x) as never });
    const a = await openTab();
    const b = await openTab();
    await a.store.timeEntries.delete({ where: { id: x } });
    // B har fortfarande X i minnet och sparar sitt snapshot.
    await b.store.timeEntries.create({ data: entry(uuidv7()) as never });

    const fresh = await openTab();
    expect(await fresh.store.timeEntries.findUnique({ where: { id: x } })).toBeNull();
  });

  it("flikens egen köade ändring av en rad vinner över en annan fliks", async () => {
    const openTab = browser(fakeServer().transport);
    const seedTab = await openTab();
    const x = uuidv7();
    await seedTab.store.timeEntries.create({ data: entry(x) as never });
    const a = await openTab();
    const b = await openTab();
    await a.store.timeEntries.update({ where: { id: x }, data: { minutes: 45 } });
    await b.store.timeEntries.update({ where: { id: x }, data: { minutes: 60 } });

    const fresh = await openTab();
    expect(await fresh.store.timeEntries.findUnique({ where: { id: x } })).toMatchObject({ minutes: 60 });
  });

  it("efter synken finns raden en gång, och kön är tom", async () => {
    const openTab = browser(fakeServer().transport);
    const a = await openTab();
    const b = await openTab();
    const x = uuidv7();
    await a.store.timeEntries.create({ data: entry(x) as never });
    await b.store.timeEntries.create({ data: entry(uuidv7()) as never });

    const fresh = await openTab();
    await fresh.reconcile();
    expect(await ids(fresh)).toHaveLength(2);
    expect(fresh.pendingCount()).toBe(0);
    expect(await ids(await openTab())).toHaveLength(2);
  });
});

describe("snapshotet behåller inga provisoriska rader utan köpost (#1714, fel 2)", () => {
  it("B kör en procedur offline, A kvitterar, B sparar → en ny flik har bara serverns rad", async () => {
    const server = fakeServer();
    const openTab = browser(server.transport);
    const a = await openTab();
    const b = await openTab();
    const provisional = uuidv7();
    await b.runQueuedProcedure({ path: "timeEntry.create", input: {} }, async () => {
      await b.store.timeEntries.create({ data: entry(provisional) as never });
    });
    // A skickar anropet; servern skapar raden med sitt eget id och A kvitterar.
    await a.reconcile();
    expect(a.pendingCount()).toBe(0);
    // B har inte läst om kön, och sparar sitt snapshot med den provisoriska raden.
    const other = uuidv7();
    await b.store.timeEntries.create({ data: entry(other) as never });

    const fresh = await openTab();
    await fresh.reconcile();
    expect(await ids(fresh)).toEqual([...server.created, other].sort());
    // Det sparade snapshotet är också rent: nästa flik ser samma sak utan synk.
    expect(await ids(await openTab())).toEqual([...server.created, other].sort());
  });

  it("B har läst om kön men inte synkat: raderna läses ändå om efter en omstart", async () => {
    const server = fakeServer();
    const openTab = browser(server.transport, changeChannelHub());
    const a = await openTab();
    const b = await openTab();
    const provisional = uuidv7();
    await b.runQueuedProcedure({ path: "timeEntry.create", input: {} }, async () => {
      await b.store.timeEntries.create({ data: entry(provisional) as never });
    });
    await settle();
    await a.reconcile();
    // Kvitteringen når B (kön läses om), men B synkar inte innan den sparar.
    await settle();
    expect(b.pendingCount()).toBe(0);
    const seedRow = uuidv7();
    await b.requeue({ mutationId: uuidv7(), entity: "timeEntry", kind: "create", row: entry(seedRow), enqueuedAt: 1 });

    const fresh = await openTab();
    await fresh.reconcile();
    expect(await ids(fresh)).toEqual([...server.created, seedRow].sort());
  });

  it("A sparar efter kvitteringen: B:s provisoriska rader bärs inte över", async () => {
    const server = fakeServer();
    const openTab = browser(server.transport);
    const a = await openTab();
    const b = await openTab();
    const provisional = uuidv7();
    await b.runQueuedProcedure({ path: "timeEntry.create", input: {} }, async () => {
      await b.store.timeEntries.create({ data: entry(provisional) as never });
    });
    await a.reconcile();
    await b.store.timeEntries.create({ data: entry(uuidv7()) as never });
    // A känner igen anropet som avgjort och skriver sitt eget, rena snapshot.
    await a.reconcile();

    const fresh = await openTab();
    expect(await fresh.store.timeEntries.findUnique({ where: { id: provisional } })).toBeNull();
  });

  it("B sparar mitt i sin egen reconcile: raderna som ska läsas om går inte förlorade", async () => {
    const server = fakeServer();
    const openTab = browser(server.transport, changeChannelHub());
    const held = heldPull(server.transport);
    const a = await openTab();
    const b = await openTab(held.transport);
    const provisional = uuidv7();
    await b.runQueuedProcedure({ path: "timeEntry.create", input: {} }, async () => {
      await b.store.timeEntries.create({ data: entry(provisional) as never });
    });
    await settle();
    // B står i sin pull när A kvitterar anropet och kanalen får B att läsa om kön.
    const running = b.reconcile();
    await settle();
    await a.reconcile();
    await settle();
    expect(b.pendingCount()).toBe(0);
    // Sparningen lämnar över raderna till motorn, medan dess reconcile pågår.
    const other = uuidv7();
    await b.store.timeEntries.create({ data: entry(other) as never });
    held.release();
    await running;
    await b.reconcile();
    await b.reconcile();

    expect(await ids(b)).toEqual([...server.created, other].sort());
    const fresh = await openTab();
    await fresh.reconcile();
    expect(await ids(fresh)).toEqual([...server.created, other].sort());
  });
});
