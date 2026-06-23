/**
 * `CachingSyncDataStore` (#415) — komponerar LocalStore (C1) + MutationQueue (C2)
 * + ReconcileEngine (C3) till offline-first-vägen. Testar online + offline mot
 * en fejk-`SyncTransport` (ingen körande server behövs — server-impl är #410/#411).
 */

import { describe, it, expect } from "vitest-compat";
import { CachingSyncDataStore, noSyncTransport } from "@/lib/server/data-store/in-memory/caching-sync-data-store";
import { InMemoryPersistence } from "@/lib/server/data-store/in-memory/local-store-persistence";
import type { QueuedMutation } from "@/lib/server/data-store/in-memory/mutation-queue";
import type { PullResult, PushResult, SyncTransport } from "@/lib/server/data-store/in-memory/sync-transport";
import { InMemoryMatterRepository } from "@/lib/server/repositories/in-memory-matter-repository";
import { asId } from "@/lib/shared/schemas/ids";
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

  // #633: synk-vägen levererar RÅA rader (writeCanonical), men demo-vägen
  // pre-bakar joins (prebakeJoins) → matterContact.contact mm. UI:t (matter-
  // detalj `include: { contact: true }`) förlitar sig på den bakade joinen
  // (matters.contacts-relationen saknar nested contact). Utan prebake på pull
  // visas "(kontakt saknas)". Reconcile måste re-baka source efter apply.
  describe("join-prebake på pull (server-first-paritet, #633)", () => {
    it("pullade matterContacts får bakad contact → matter-detalj resolver namnet", async () => {
      const mId = uuidv7(), cId = uuidv7(), mcId = uuidv7();
      const transport = new FakeTransport();
      transport.pullResult = {
        changes: [
          { entity: "matter", row: matter(mId) },
          { entity: "contact", row: { id: cId, organizationId: ORG, name: "Anna Andersson", contactType: "PERSON" } },
          { entity: "matterContact", row: { id: mcId, matterId: mId, contactId: cId, role: "KLIENT" } },
        ],
        cursor: 10,
      };
      const ds = await CachingSyncDataStore.create({ transport, persistence: new InMemoryPersistence() });
      await ds.reconcile();

      const detail = await new InMemoryMatterRepository(ds.store).getByIdWithContacts(asId<"MatterId">(mId), asId<"OrganizationId">(ORG));
      expect(detail?.contacts).toHaveLength(1);
      expect(detail?.contacts[0]?.contact?.name).toBe("Anna Andersson");
    });

    it("pullade timeEntries får bakad matter (te.matter.title resolver)", async () => {
      const mId = uuidv7(), teId = uuidv7();
      const transport = new FakeTransport();
      transport.pullResult = {
        changes: [
          { entity: "matter", row: matter(mId, "Vårdnadstvist") },
          { entity: "timeEntry", row: { id: teId, organizationId: ORG, matterId: mId, minutes: 60, billable: true, hourlyRate: 2000 } },
        ],
        cursor: 11,
      };
      const ds = await CachingSyncDataStore.create({ transport, persistence: new InMemoryPersistence() });
      await ds.reconcile();

      const te = await ds.store.timeEntries.findFirst({ where: { id: teId } }) as { matter?: { title?: string } } | null;
      expect(te?.matter?.title).toBe("Vårdnadstvist");
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

  describe("createEphemeral (demo-vägen #419 — synkron, writeBack, inget synk-mål)", () => {
    it("skriver lokalt, anropar writeBack per mutation, köar (men synkar aldrig)", async () => {
      const events: string[] = [];
      const ds = CachingSyncDataStore.createEphemeral({
        transport: noSyncTransport,
        writeBack: (e) => { events.push(`${e.kind}:${e.entity}`); },
      });
      const m1 = uuidv7();
      await ds.store.matters.create({ data: matter(m1) as never });

      expect(await ds.store.matters.findUnique({ where: { id: m1 } })).toMatchObject({ id: m1 });
      expect(events).toEqual(["create:matter"]); // writeBack-pipelinen (slab/FSA) fick eventet
      expect(ds.pendingCount()).toBe(1); // köad lokalt
    });

    it("delar seed-referensen (clone fyller source efter create)", async () => {
      const source: { matters?: Record<string, unknown>[] } = {};
      const ds = CachingSyncDataStore.createEphemeral({ transport: noSyncTransport, seed: source as never });
      // Simulera att clone fyller den delade source-refen efteråt.
      source.matters = [matter(uuidv7())];
      const list = await ds.store.matters.findMany({});
      expect(list).toHaveLength(1);
    });
  });

  describe("noSyncTransport", () => {
    it("pull ger tom delta, push ekar raden som accepted", async () => {
      expect(await noSyncTransport.pull(0)).toEqual({ changes: [], cursor: 0 });
      const row = { id: "x" };
      expect(await noSyncTransport.push({ mutationId: "m", entity: "matter", kind: "create", row, enqueuedAt: 0 })).toEqual({
        status: "accepted",
        row,
      });
    });
  });

  // #544/ADR 0025 regression: en reconcile som pullar in N rader (demons seed-
  // hydrering) får INTE persistera per rad — det blev O(n²) bytes och hängde
  // demon på mobil-IndexedDB ("AVA laddar…"). EN skrivning per batch, och tom
  // poll-reconcile skriver inte alls.
  describe("persist-per-batch (inte per rad)", () => {
    it("persisterar snapshotet en gång för en N-raders pull; tom reconcile = 0 skrivningar", async () => {
      const transport = new FakeTransport();
      transport.pullResult = {
        changes: Array.from({ length: 5 }, (_, i) => ({ entity: "matter", row: matter(uuidv7(), `M${i}`) })),
        cursor: 5,
      };
      let saves = 0;
      const persistence = { hydrate: async () => null, save: async () => { saves++; } };
      const ds = await CachingSyncDataStore.create({ transport, persistence });

      const r = await ds.reconcile();
      expect(r.pulled).toBe(5);
      expect(saves).toBe(1); // EN skrivning för hela batchen, inte 5

      transport.pullResult = { changes: [], cursor: 5 };
      await ds.reconcile();
      expect(saves).toBe(1); // tom poll-reconcile → ingen extra skrivning
    });
  });
});
