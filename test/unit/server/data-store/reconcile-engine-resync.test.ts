/**
 * Klienten och en server som återställts ur backup (#1360).
 *
 * Läses serverns databas in ur en backup går dess change_log tillbaka. Servern
 * märker det på klientens epok (eller en cursor före den säkra gränsen) och
 * svarar med `resync`: hela historiken från 0. Det som skyddas:
 *   - klienten skickar sin epok och sparar serverns,
 *   - vid omsynk tas lokala rader som inte finns i den återställda databasen
 *     bort — men aldrig rader med köade, ej synkade ändringar,
 *   - kön rörs inte: köade ändringar spelas upp mot den återställda servern,
 *   - en ofullständig reconcile efter omsynk står kvar på 0, inte på den gamla
 *     positionen (som hör till en annan historik),
 *   - med sidindelad pull (#1388): omsynken gäller från sidan som bar `resync`,
 *     resten av sidorna hämtas med den NYA epoken, och raderna tas bort först
 *     när alla sidor är hämtade — med varje rad från alla sidorna som behålls.
 */

import { describe, expect, it } from "vitest-compat";
import { CachingSyncDataStore } from "@/lib/server/data-store/in-memory/caching-sync-data-store";
import { InMemoryCursorStore } from "@/lib/server/data-store/in-memory/cursor-store";
import { InMemoryPersistence } from "@/lib/server/data-store/in-memory/local-store-persistence";
import { InMemoryMutationQueuePersistence, MutationQueue } from "@/lib/server/data-store/in-memory/mutation-queue";
import { ReconcileEngine, type ApplyCanonical } from "@/lib/server/data-store/in-memory/reconcile-engine";
import type { PulledChange, PullResult, PushResult, SyncTransport } from "@/lib/server/data-store/in-memory/sync-transport";
import { uuidv7 } from "@/lib/shared/uuid";

const OLD = "01a0f754-b809-7662-8de5-646987f19b9e";
const NEW = "01a0f754-b809-7662-8de5-646987f19b9f";

class ResyncTransport implements SyncTransport {
  pulls: Array<{ since: number; epoch: string | undefined }> = [];
  result: PullResult = { changes: [], cursor: 0 };
  pushResult: (row: Record<string, unknown>) => PushResult = (row) => ({ status: "accepted", row });
  async pull(since: number, epoch?: string): Promise<PullResult> {
    this.pulls.push({ since, epoch });
    return this.result;
  }
  async rows(refs: readonly { entity: string; id: string }[]): Promise<PulledChange[]> {
    return refs.map((r) => ({ entity: r.entity, row: { id: r.id }, deleted: true }));
  }
  async push(m: { row: Record<string, unknown> }): Promise<PushResult> {
    return this.pushResult(m.row);
  }
  async pushProcedure(): Promise<{ status: "accepted"; rows: [] }> {
    return { status: "accepted", rows: [] };
  }
}

function engine(transport: SyncTransport, queue: MutationQueue, cursor: InMemoryCursorStore, prune?: (keep: ReadonlySet<string>) => number) {
  const apply: ApplyCanonical = () => undefined;
  return new ReconcileEngine({ transport, queue, cursor, apply, ...(prune ? { prune } : {}) });
}

describe("ReconcileEngine — epok och omsynk (#1360)", () => {
  it("skickar den sparade epoken och sparar serverns", async () => {
    const transport = new ResyncTransport();
    const cursor = new InMemoryCursorStore(5);
    await cursor.setEpoch(OLD);
    transport.result = { changes: [], cursor: 9, epoch: OLD };
    const res = await engine(transport, await MutationQueue.hydrate(), cursor).reconcile();
    expect(transport.pulls).toEqual([{ since: 5, epoch: OLD }]);
    expect(res).toMatchObject({ cursor: 9, pruned: 0 });
    expect(await cursor.getEpoch()).toBe(OLD);
  });

  it("utan epok i svaret (äldre server) behålls den sparade", async () => {
    const transport = new ResyncTransport();
    const cursor = new InMemoryCursorStore();
    await cursor.setEpoch(OLD);
    transport.result = { changes: [], cursor: 3 };
    await engine(transport, await MutationQueue.hydrate(), cursor).reconcile();
    expect(await cursor.getEpoch()).toBe(OLD);
  });

  it("omsynk: rader som saknas i serverns historik tas bort, utom de med köade ändringar", async () => {
    const transport = new ResyncTransport();
    const cursor = new InMemoryCursorStore(500);
    await cursor.setEpoch(OLD);
    const queue = await MutationQueue.hydrate(new InMemoryMutationQueuePersistence());
    await queue.enqueue({ entity: "contact", kind: "update", row: { id: "c-queued" } }, { mutationId: "m1" });
    transport.result = {
      changes: [{ entity: "matter", row: { id: "m-kept" } }, { entity: "matter", row: { id: "m-tomb" }, deleted: true }],
      cursor: 120, epoch: NEW, resync: true,
    };
    let kept: string[] = [];
    const res = await engine(transport, queue, cursor, (keep) => { kept = [...keep].sort(); return 4; }).reconcile();
    expect(kept).toEqual(["contact:c-queued", "matter:m-kept"]);
    expect(res).toMatchObject({ pruned: 4, cursor: 120, pushed: 1 });
    expect(await cursor.getEpoch()).toBe(NEW);
    expect(queue.size()).toBe(0); // den köade ändringen spelades upp mot den återställda servern
  });

  it("omsynk utan prune-funktion (demo, tester) tar inte bort något", async () => {
    const transport = new ResyncTransport();
    transport.result = { changes: [], cursor: 10, epoch: NEW, resync: true };
    const res = await engine(transport, await MutationQueue.hydrate(), new InMemoryCursorStore(50)).reconcile();
    expect(res.pruned).toBe(0);
  });

  it("utan omsynk anropas aldrig prune", async () => {
    const transport = new ResyncTransport();
    transport.result = { changes: [], cursor: 10, epoch: OLD };
    let called = false;
    await engine(transport, await MutationQueue.hydrate(), new InMemoryCursorStore(), () => { called = true; return 0; }).reconcile();
    expect(called).toBe(false);
  });

  it("omsynk där kön stannar → cursorn står på 0, inte på den gamla positionen", async () => {
    const transport = new ResyncTransport();
    const cursor = new InMemoryCursorStore(500);
    const queue = await MutationQueue.hydrate(new InMemoryMutationQueuePersistence());
    await queue.enqueue({ entity: "contact", kind: "update", row: { id: "c1" } }, { mutationId: "m1" });
    transport.result = { changes: [], cursor: 120, epoch: NEW, resync: true };
    // Nätet försvinner när kön spelas upp: kön stannar.
    transport.pushResult = () => { throw Object.assign(new Error("Failed to fetch"), { name: "TRPCClientError" }); };
    const res = await engine(transport, queue, cursor, () => 0).reconcile();
    expect(res.blocked).not.toBeNull();
    expect(res.cursor).toBe(0);
    expect(await cursor.get()).toBe(0);
    expect(await cursor.getEpoch()).toBe(NEW);
    expect(queue.size()).toBe(1);
  });
});

/** En transport som svarar med sidorna i tur och ordning. */
class PagedTransport extends ResyncTransport {
  pages: PullResult[] = [];
  events: string[] = [];
  override async pull(since: number, epoch?: string): Promise<PullResult> {
    this.pulls.push({ since, epoch });
    this.events.push(`pull ${since}`);
    return this.pages.shift() ?? { changes: [], cursor: since };
  }
}

const live = (entity: string, id: string): PulledChange => ({ entity, row: { id } });

describe("ReconcileEngine — omsynk med sidindelad pull (#1360 + #1388)", () => {
  it("resync på första sidan: resten hämtas med den nya epoken, prune EN gång efter sista sidan med alla sidornas rader", async () => {
    const transport = new PagedTransport();
    const cursor = new InMemoryCursorStore(500); // före den återställda servern
    await cursor.setEpoch(OLD);
    const queue = await MutationQueue.hydrate(new InMemoryMutationQueuePersistence());
    await queue.enqueue({ entity: "contact", kind: "update", row: { id: "c-queued" } }, { mutationId: "m1" });
    transport.pages = [
      { changes: [live("matter", "m1"), live("matter", "m2")], cursor: 2, hasMore: true, epoch: NEW, resync: true },
      { changes: [live("contact", "c1"), { entity: "matter", row: { id: "m-tomb" }, deleted: true }], cursor: 4, hasMore: true, epoch: NEW },
      { changes: [live("task", "t1")], cursor: 5, epoch: NEW },
    ];
    let kept: string[] = [];
    const prune = (keep: ReadonlySet<string>): number => {
      transport.events.push("prune");
      kept = [...keep].sort();
      return 3;
    };
    const res = await engine(transport, queue, cursor, prune).reconcile();
    // Klientens gamla cursor (500) ligger före servern: sidorna går 0 → 2 → 4, inte bakåt-stopp.
    expect(transport.pulls).toEqual([{ since: 500, epoch: OLD }, { since: 2, epoch: NEW }, { since: 4, epoch: NEW }]);
    expect(transport.events).toEqual(["pull 500", "pull 2", "pull 4", "prune"]);
    expect(kept).toEqual(["contact:c-queued", "contact:c1", "matter:m1", "matter:m2", "task:t1"]);
    expect(res).toMatchObject({ pulled: 5, pruned: 3, cursor: 5, pushed: 1 });
    expect(await cursor.get()).toBe(5);
    expect(await cursor.getEpoch()).toBe(NEW);
  });

  it("resync på en senare sida börjar om: raderna från sidorna före den behålls inte", async () => {
    const transport = new PagedTransport();
    const cursor = new InMemoryCursorStore(8);
    await cursor.setEpoch(OLD);
    transport.pages = [
      { changes: [live("matter", "gammal")], cursor: 10, hasMore: true, epoch: OLD },
      // Servern återställdes mitt i: nästa sida börjar om från 0.
      { changes: [live("matter", "ny-1")], cursor: 3, hasMore: true, epoch: NEW, resync: true },
      { changes: [live("matter", "ny-2")], cursor: 6, epoch: NEW },
    ];
    let kept: string[] = [];
    const res = await engine(transport, await MutationQueue.hydrate(), cursor, (keep) => { kept = [...keep].sort(); return 1; }).reconcile();
    expect(transport.pulls.map((p) => p.since)).toEqual([8, 10, 3]);
    expect(kept).toEqual(["matter:ny-1", "matter:ny-2"]);
    expect(res).toMatchObject({ cursor: 6, pruned: 1 });
  });

  it("omsynk där kön stannar efter flera sidor → cursorn står på 0", async () => {
    const transport = new PagedTransport();
    const cursor = new InMemoryCursorStore(500);
    const queue = await MutationQueue.hydrate(new InMemoryMutationQueuePersistence());
    await queue.enqueue({ entity: "contact", kind: "update", row: { id: "c1" } }, { mutationId: "m1" });
    transport.pages = [
      { changes: [live("matter", "m1")], cursor: 2, hasMore: true, epoch: NEW, resync: true },
      { changes: [live("matter", "m2")], cursor: 4, epoch: NEW },
    ];
    transport.pushResult = () => { throw Object.assign(new Error("Failed to fetch"), { name: "TRPCClientError" }); };
    const res = await engine(transport, queue, cursor, () => 0).reconcile();
    expect(res.blocked).not.toBeNull();
    expect(await cursor.get()).toBe(0);
    expect(await cursor.getEpoch()).toBe(NEW);
  });
});

describe("CachingSyncDataStore — omsynk efter återställd server (#1360)", () => {
  it("tar bort lokala rader som inte finns på servern, behåller köade och persisterar", async () => {
    const ghost = uuidv7(), kept = uuidv7(), mine = uuidv7();
    const transport = new ResyncTransport();
    const persistence = new InMemoryPersistence();
    const ds = await CachingSyncDataStore.create({
      transport,
      persistence,
      seed: { matters: [{ id: ghost, title: "Skrevs efter backupen" }, { id: kept, title: "Finns i backupen" }] } as never,
    });
    // En lokal, ej synkad ändring: ska överleva omsynken och spelas upp.
    await ds.store.contacts.create({ data: { id: mine, name: "Offline-kontakt" } as never });
    transport.result = { changes: [{ entity: "matter", row: { id: kept, title: "Finns i backupen" } }], cursor: 40, epoch: NEW, resync: true };

    const res = await ds.reconcile();
    expect(res.pruned).toBe(1);
    expect(res.pushed).toBe(1);
    expect(await ds.store.matters.findUnique({ where: { id: ghost } })).toBeNull();
    expect(await ds.store.matters.findUnique({ where: { id: kept } })).toMatchObject({ title: "Finns i backupen" });
    expect(await ds.store.contacts.findUnique({ where: { id: mine } })).toMatchObject({ name: "Offline-kontakt" });
    const saved = await persistence.hydrate();
    expect((saved?.matters ?? []).map((m) => m.id)).toEqual([kept]);
  });
});

describe("CachingSyncDataStore — omsynk över flera sidor (#1360 + #1388)", () => {
  it("rader från alla sidorna behålls, spökraden tas bort först efter sista sidan", async () => {
    const ghost = uuidv7(), first = uuidv7(), second = uuidv7();
    const transport = new PagedTransport();
    const ds = await CachingSyncDataStore.create({
      transport,
      persistence: new InMemoryPersistence(),
      seed: { matters: [{ id: ghost, title: "Spöke" }, { id: first, title: "Sida 1" }, { id: second, title: "Sida 2" }] } as never,
    });
    transport.pages = [
      { changes: [{ entity: "matter", row: { id: first, title: "Sida 1" } }], cursor: 7, hasMore: true, epoch: NEW, resync: true },
      { changes: [{ entity: "matter", row: { id: second, title: "Sida 2" } }], cursor: 9, epoch: NEW },
    ];
    const res = await ds.reconcile();
    expect(res).toMatchObject({ pruned: 1, cursor: 9 });
    expect(await ds.store.matters.findUnique({ where: { id: ghost } })).toBeNull();
    expect(await ds.store.matters.findUnique({ where: { id: first } })).toMatchObject({ title: "Sida 1" });
    expect(await ds.store.matters.findUnique({ where: { id: second } })).toMatchObject({ title: "Sida 2" });
  });
});
