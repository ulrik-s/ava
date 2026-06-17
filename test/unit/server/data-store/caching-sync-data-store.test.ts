/**
 * `CachingSyncDataStore` (#415) — komponerar LocalStore (C1) + MutationQueue (C2)
 * + ReconcileEngine (C3) till offline-first-vägen. Testar online + offline mot
 * en fejk-`SyncTransport` (ingen körande server behövs — server-impl är #410/#411).
 */

import { describe, it, expect } from "vitest-compat";
import { CachingSyncDataStore } from "@/lib/server/data-store/in-memory/caching-sync-data-store";
import { InMemoryPersistence } from "@/lib/server/data-store/in-memory/local-store-persistence";
import type { QueuedMutation } from "@/lib/server/data-store/in-memory/mutation-queue";
import type { PullResult, PushResult, SyncTransport } from "@/lib/server/data-store/in-memory/sync-transport";
import { uuidv7 } from "@/lib/shared/uuid";

class FakeTransport implements SyncTransport {
  pullResult: PullResult = { changes: [], cursor: 0 };
  pushImpl: (m: QueuedMutation) => PushResult = (m) => ({ status: "accepted", row: { ...m.row, version: 2 } });
  pushed: QueuedMutation[] = [];
  async pull(): Promise<PullResult> {
    return this.pullResult;
  }
  async push(m: QueuedMutation): Promise<PushResult> {
    this.pushed.push(m);
    return this.pushImpl(m);
  }
}

const ORG = uuidv7();

function matter(id: string, title = "Ärende") {
  return { id, organizationId: ORG, title, status: "ACTIVE", matterNumber: "2026-0001" };
}

describe("CachingSyncDataStore (#415)", () => {
  describe("offline — lokal-först + optimistisk kö", () => {
    it("skriver lokalt, köar mutationen och rör inte transporten", async () => {
      const transport = new FakeTransport();
      const persistence = new InMemoryPersistence();
      const ds = await CachingSyncDataStore.create({ transport, persistence });

      const m1 = uuidv7();
      await ds.store.matters.create({ data: matter(m1) as never });

      // Läsbart direkt lokalt (offline).
      expect(await ds.store.matters.findUnique({ where: { id: m1 } })).toMatchObject({ id: m1, title: "Ärende" });
      // Köad, inte synkad.
      expect(ds.pendingCount()).toBe(1);
      expect(transport.pushed).toHaveLength(0);
      // Persisterad till (in-memory) store.
      const saved = await persistence.hydrate();
      expect(saved?.matters).toHaveLength(1);
    });
  });

  describe("online — reconcile (pull + replay)", () => {
    it("spelar upp köade mutationer och applicerar serverns kanoniska rad", async () => {
      const transport = new FakeTransport();
      const ds = await CachingSyncDataStore.create({ transport, persistence: new InMemoryPersistence() });

      const m1 = uuidv7();
      await ds.store.matters.create({ data: matter(m1) as never });
      // Servern accepterar och bumpar version.
      transport.pushImpl = (m) => ({ status: "accepted", row: { ...m.row, version: 5 } });

      const res = await ds.reconcile();

      expect(res.pushed).toBe(1);
      expect(res.conflicts).toHaveLength(0);
      expect(ds.pendingCount()).toBe(0); // kön tömd
      // Lokala raden rebasad till serverns kanoniska (version 5).
      const row = await ds.store.matters.findUnique({ where: { id: m1 } });
      expect(row).toMatchObject({ id: m1, version: 5 });
    });

    it("applicerar pullade kanoniska rader (server-skapade) lokalt + avancerar cursor", async () => {
      const c1 = uuidv7();
      const transport = new FakeTransport();
      transport.pullResult = {
        changes: [{ entity: "contact", row: { id: c1, organizationId: ORG, name: "Server-kontakt" } }],
        cursor: 42,
      };
      const ds = await CachingSyncDataStore.create({ transport, persistence: new InMemoryPersistence() });

      const res = await ds.reconcile();

      expect(res.pulled).toBe(1);
      expect(res.cursor).toBe(42);
      expect(await ds.store.contacts.findUnique({ where: { id: c1 } })).toMatchObject({ id: c1, name: "Server-kontakt" });
    });

    it("applicerar en tombstone (deleted) genom att ta bort raden lokalt", async () => {
      const m1 = uuidv7();
      const transport = new FakeTransport();
      const ds = await CachingSyncDataStore.create({
        transport,
        seed: { matters: [matter(m1)] },
        persistence: new InMemoryPersistence(),
      });
      transport.pullResult = { changes: [{ entity: "matter", row: { id: m1 }, deleted: true }], cursor: 7 };

      await ds.reconcile();

      expect(await ds.store.matters.findUnique({ where: { id: m1 } })).toBeNull();
    });
  });

  describe("konflikt — surface-klassen ytläggs", () => {
    it("avvisad push ytläggs som konflikt och tas ur kön", async () => {
      const transport = new FakeTransport();
      const ds = await CachingSyncDataStore.create({ transport, persistence: new InMemoryPersistence() });

      const inv = uuidv7();
      await ds.store.invoices.create({ data: { id: inv, organizationId: ORG, matterId: uuidv7(), status: "DRAFT" } as never });
      transport.pushImpl = () => ({ status: "conflict", reason: "stale-status" });

      const res = await ds.reconcile();

      expect(res.pushed).toBe(0);
      expect(res.conflicts).toHaveLength(1);
      expect(res.conflicts[0]).toMatchObject({ conflictClass: "surface", reason: "stale-status" });
      expect(ds.pendingCount()).toBe(0); // acked trots konflikt (blockerar inte kön)
    });
  });
});
