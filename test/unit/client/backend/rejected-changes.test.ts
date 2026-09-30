/**
 * Avvisade ändringar (#1266) — ingen avvisad ändring får försvinna tyst.
 */
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest-compat";
import { describeQueueEntry } from "@/lib/client/backend/describe-queue-entry";
import {
  IndexedDbRejectedChangesPersistence,
  InMemoryRejectedChangesPersistence,
  RejectedChanges,
} from "@/lib/client/backend/rejected-changes";
import type { QueuedMutation, QueuedProcedureCall } from "@/lib/server/data-store/in-memory/mutation-queue";
import type { ConflictRecord } from "@/lib/server/data-store/in-memory/reconcile-engine";
import { QUEUED_PROCEDURES } from "@/lib/shared/sync/queued-procedures";

const row: QueuedMutation = { mutationId: "r1", entity: "invoice", kind: "update", row: { id: "i1" }, baseVersion: 2, enqueuedAt: 0 };
const call: QueuedProcedureCall = {
  type: "procedure", mutationId: "p1", path: "billingRun.createFinal", input: { matterId: "m" }, codeVersion: "v", touches: [], enqueuedAt: 0,
};
const conflict = (mutation: QueuedMutation | QueuedProcedureCall, reason = "stale"): ConflictRecord =>
  ({ mutation, conflictClass: "surface", reason, current: { id: "i1", version: 5 } });

describe("RejectedChanges", () => {
  it("sparar avvisningar med svensk beskrivning, skäl och serverns läge", async () => {
    const store = new RejectedChanges();
    await store.record([conflict(row), conflict(call, "Posterna är redan fakturerade.")], 1000);
    expect(store.list()).toEqual([
      { id: "r1", rejectedAt: 1000, label: "Ändring av faktura", reason: "stale", entry: row, current: { id: "i1", version: 5 } },
      { id: "p1", rejectedAt: 1000, label: "Slutfaktura", reason: "Posterna är redan fakturerade.", entry: call, current: { id: "i1", version: 5 } },
    ]);
  });

  it("samma ändring sparas bara en gång; tomma omgångar ändrar inget", async () => {
    const persistence = new InMemoryRejectedChangesPersistence();
    const save = vi.spyOn(persistence, "save");
    const store = new RejectedChanges(persistence);
    await store.record([conflict(row)]);
    await store.record([conflict(row)]);
    await store.record([]);
    expect(store.list()).toHaveLength(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("kasta: ändringen tas bort (serverns läge gäller)", async () => {
    const store = new RejectedChanges();
    await store.record([conflict(row)]);
    await store.discard("r1");
    expect(store.list()).toEqual([]);
  });

  it("försök igen: köas via den registrerade synken och tas sedan bort", async () => {
    const store = new RejectedChanges();
    await store.record([conflict(call)]);
    const retried: string[] = [];
    const unregister = store.setRetryHandler(async (c) => { retried.push(c.id); });
    await store.retry("p1");
    expect(retried).toEqual(["p1"]);
    expect(store.list()).toEqual([]);
    unregister();
    await store.retry("finns-inte"); // no-op
  });

  it("försök igen utan synk mot servern → tydligt fel, ändringen ligger kvar", async () => {
    const store = new RejectedChanges();
    await store.record([conflict(row)]);
    await expect(store.retry("r1")).rejects.toThrow(/Ingen synk mot servern/);
    expect(store.list()).toHaveLength(1);
  });

  it("en gammal avregistrering rör inte en nyare synk", async () => {
    const store = new RejectedChanges();
    await store.record([conflict(row)]);
    const first = store.setRetryHandler(async () => {});
    const retried: string[] = [];
    store.setRetryHandler(async (c) => { retried.push(c.id); });
    first();
    await store.retry("r1");
    expect(retried).toEqual(["r1"]);
  });

  it("överlever omladdning: IndexedDB → attach läser in, och lyssnare får listan", async () => {
    const factory = new IDBFactory();
    const first = new RejectedChanges();
    await first.attach(new IndexedDbRejectedChangesPersistence(factory, "ava-rejected-test"));
    await first.record([conflict(row)], 7);
    const second = new RejectedChanges();
    const seen: number[] = [];
    second.subscribe((items) => seen.push(items.length));
    await second.attach(new IndexedDbRejectedChangesPersistence(factory, "ava-rejected-test"));
    expect(second.list().map((i) => i.id)).toEqual(["r1"]);
    expect(seen).toEqual([1]);
  });

  it("en tom IndexedDB ger en tom lista", async () => {
    expect(await new IndexedDbRejectedChangesPersistence(new IDBFactory(), "ava-rejected-empty").load()).toEqual([]);
  });

  it("avslutad prenumeration får inga fler uppdateringar", async () => {
    const store = new RejectedChanges();
    const seen: number[] = [];
    const off = store.subscribe((items) => seen.push(items.length));
    off();
    await store.record([conflict(row)]);
    expect(seen).toEqual([]);
  });
});

describe("describeQueueEntry", () => {
  it("köbara procedurer med egna namn; okända med sökvägen", () => {
    expect(describeQueueEntry({ ...call, path: "timeEntry.create" })).toBe("Ny tidspost");
    expect(describeQueueEntry({ ...call, path: "okänd.proc" })).toBe("Ändring (okänd.proc)");
  });

  it("varje köbar procedur har ett eget namn — ingen visas som sökväg", () => {
    const unnamed = Object.keys(QUEUED_PROCEDURES).filter((path) => describeQueueEntry({ ...call, path }).startsWith("Ändring ("));
    expect(unnamed).toEqual([]);
  });

  it("radposter: ny/ändring/borttagning av entiteten; okänd entitet med sitt namn", () => {
    expect(describeQueueEntry({ ...row, kind: "create", entity: "matter" })).toBe("Nytt ärende");
    expect(describeQueueEntry({ ...row, kind: "create", entity: "contact" })).toBe("Ny kontakt");
    expect(describeQueueEntry({ ...row, kind: "delete", entity: "document" })).toBe("Borttagning av dokument");
    expect(describeQueueEntry({ ...row, entity: "widget" })).toBe("Ändring av widget");
  });
});
