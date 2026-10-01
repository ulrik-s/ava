/**
 * `CachingSyncDataStore` — ingen spökrad efter en avvisad ändring (#1348).
 *
 *   - reconcile: en avvisad rad ersätts lokalt av serverns läge (`current`),
 *     eller tas bort när servern inte har den — och snapshotet sparas,
 *   - `restore` ("Kasta"): raderna hämtas från servern och skrivs lokalt;
 *     en rad med en ny, ej synkad ändring rörs inte,
 *   - `requeue` ("Försök igen"): radens lokala läge läggs tillbaka.
 */
import { describe, expect, it } from "vitest-compat";
import { CachingSyncDataStore } from "@/lib/server/data-store/in-memory/caching-sync-data-store";
import { InMemoryPersistence } from "@/lib/server/data-store/in-memory/local-store-persistence";
import { InMemoryMutationQueuePersistence, type QueuedMutation } from "@/lib/server/data-store/in-memory/mutation-queue";
import type {
  ProcedureReplayResult, PulledChange, PullResult, PushResult, RowRef, SyncTransport,
} from "@/lib/server/data-store/in-memory/sync-transport";
import type { DemoSource } from "@/lib/shared/demo-source";
import { uuidv7 } from "@/lib/shared/uuid";

class Server implements SyncTransport {
  rowsById = new Map<string, Record<string, unknown>>();
  pushImpl: (m: QueuedMutation) => PushResult = (m) => ({ status: "accepted", row: m.row });
  rowRequests: string[][] = [];
  async pull(): Promise<PullResult> { return { changes: [], cursor: 1 }; }
  async push(m: QueuedMutation): Promise<PushResult> { return this.pushImpl(m); }
  async pushProcedure(): Promise<ProcedureReplayResult> { return { status: "accepted", rows: [] }; }
  async rows(refs: readonly RowRef[]): Promise<PulledChange[]> {
    this.rowRequests.push(refs.map((r) => r.id));
    return refs.map((r) => {
      const row = this.rowsById.get(r.id);
      return row ? { entity: r.entity, row } : { entity: r.entity, row: { id: r.id }, deleted: true };
    });
  }
}

class CountingPersistence extends InMemoryPersistence {
  saves = 0;
  last: DemoSource | null = null;
  override async save(source: DemoSource): Promise<void> {
    this.saves++;
    this.last = structuredClone(source);
    await super.save(source);
  }
}

async function setup(seed: DemoSource = {}) {
  const server = new Server();
  const persistence = new CountingPersistence(seed);
  const ds = await CachingSyncDataStore.create({ transport: server, persistence });
  const task = (id: string) => ds.store.tasks.findUnique({ where: { id } }) as Promise<Record<string, unknown> | null>;
  return { server, persistence, ds, task };
}

describe("reconcile — avvisad rad lämnar ingen spökrad (#1348)", () => {
  it("avvisat skapande utan serverns läge → raden tas bort lokalt och snapshotet sparas", async () => {
    const h = await setup();
    const id = uuidv7();
    await h.ds.store.tasks.create({ data: { id, title: "Optimistisk" } as never });
    h.server.pushImpl = () => ({ status: "conflict", reason: "annan byrå" });
    const savesBefore = h.persistence.saves;
    const res = await h.ds.reconcile();
    expect(res.restored).toBe(1);
    expect(await h.task(id)).toBeNull();
    expect(h.persistence.saves).toBe(savesBefore + 1);
    expect(h.persistence.last?.tasks).toEqual([]);
  });

  it("avvisad ändring med serverns current → den lokala raden blir serverns", async () => {
    const id = uuidv7();
    const h = await setup({ tasks: [{ id, title: "Server", version: 3 }] });
    await h.ds.store.tasks.update({ where: { id }, data: { title: "Min ändring" } as never });
    h.server.pushImpl = () => ({ status: "conflict", reason: "stale", current: { id, title: "Kollegans", version: 4 } });
    await h.ds.reconcile();
    expect(await h.task(id)).toMatchObject({ title: "Kollegans", version: 4 });
    expect(h.server.rowRequests).toEqual([]);
  });
});

describe("restore — Kasta hämtar serverns läge (#1348)", () => {
  it("raderna skrivs lokalt (tombstone när servern saknar raden) och sparas", async () => {
    const [a, b] = [uuidv7(), uuidv7()];
    const h = await setup({ tasks: [{ id: a, title: "Spöke" }, { id: b, title: "Lokal" }] });
    h.server.rowsById.set(b, { id: b, title: "Serverns" });
    const saves = h.persistence.saves;
    const entry = (id: string): QueuedMutation => ({ mutationId: uuidv7(), entity: "task", kind: "create", row: { id }, enqueuedAt: 0 });
    expect(await h.ds.restore(entry(a))).toBe(1);
    expect(await h.ds.restore(entry(b))).toBe(1);
    expect(await h.task(a)).toBeNull();
    expect(await h.task(b)).toMatchObject({ title: "Serverns" });
    expect(h.persistence.saves).toBe(saves + 2);
  });

  it("en rad med en ny, ej synkad ändring rörs inte — inget hämtas, inget sparas", async () => {
    const id = uuidv7();
    const h = await setup({ tasks: [{ id, title: "Server" }] });
    await h.ds.store.tasks.update({ where: { id }, data: { title: "Ny ändring" } as never });
    const saves = h.persistence.saves;
    expect(await h.ds.restore({ mutationId: "gammal", entity: "task", kind: "update", row: { id }, enqueuedAt: 0 })).toBe(0);
    expect(h.server.rowRequests).toEqual([]);
    expect(await h.task(id)).toMatchObject({ title: "Ny ändring" });
    expect(h.persistence.saves).toBe(saves);
  });
});

describe("requeue — Försök igen lägger tillbaka radens lokala läge (#1348)", () => {
  it("en ändring skrivs lokalt igen; en radering tar bort raden igen", async () => {
    const [a, b] = [uuidv7(), uuidv7()];
    const h = await setup({ tasks: [{ id: a, title: "Server", version: 4 }, { id: b, title: "Kvar" }] });
    let changed = 0;
    h.ds.onLocalChange(() => { changed++; });
    await h.ds.requeue({ mutationId: "u", entity: "task", kind: "update", row: { id: a, title: "Min" }, baseVersion: 3, enqueuedAt: 1 }, { id: a, version: 4 });
    await h.ds.requeue({ mutationId: "d", entity: "task", kind: "delete", row: { id: b }, enqueuedAt: 2 });
    expect(await h.task(a)).toMatchObject({ title: "Min" });
    expect(await h.task(b)).toBeNull();
    expect(h.ds.pendingEntries().map((e) => e.mutationId)).toEqual(["u", "d"]);
    expect(h.ds.hasPendingFor("task", a)).toBe(true);
    expect(h.ds.hasPendingFor("task", uuidv7())).toBe(false);
    expect(changed).toBe(2);
  });
});

describe("flera flikar — en annan flik skickade flikens ändring (#1402)", () => {
  /** Två flikar: samma kö och server, var sitt lokala läge. */
  async function twoTabs() {
    const server = new Server();
    const queuePersistence = new InMemoryMutationQueuePersistence();
    const open = () => CachingSyncDataStore.create({ transport: server, persistence: new InMemoryPersistence(), queuePersistence });
    const a = await open();
    const b = await open();
    const task = (ds: CachingSyncDataStore, id: string) => ds.store.tasks.findUnique({ where: { id } }) as Promise<Record<string, unknown> | null>;
    return { server, a, b, task };
  }

  it("avvisad: fliken som gjorde ändringen tar bort sin spökrad vid nästa synk", async () => {
    const h = await twoTabs();
    const id = uuidv7();
    await h.b.store.tasks.create({ data: { id, title: "Optimistisk i B" } as never });
    h.server.pushImpl = () => ({ status: "conflict", reason: "annan byrå" });
    await h.a.reconcile(); // A skickar B:s post; avvisningen kommer bara till A
    expect(await h.task(h.b, id)).not.toBeNull();

    const res = await h.b.reconcile();
    expect(h.server.rowRequests.at(-1)).toEqual([id]);
    expect(res.restored).toBe(1);
    expect(await h.task(h.b, id)).toBeNull();
  });

  it("godtagen: fliken får serverns rad", async () => {
    const h = await twoTabs();
    const id = uuidv7();
    await h.b.store.tasks.create({ data: { id, title: "Lokal i B" } as never });
    h.server.rowsById.set(id, { id, title: "Serverns", version: 1 });
    await h.a.reconcile();
    await h.b.reconcile();
    expect(await h.task(h.b, id)).toMatchObject({ title: "Serverns", version: 1 });
  });
});
