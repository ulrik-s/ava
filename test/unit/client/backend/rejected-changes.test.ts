/**
 * Avvisade ändringar (#1266) — ingen avvisad ändring får försvinna tyst.
 */
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest-compat";
import { describeQueueEntry } from "@/lib/client/backend/describe-queue-entry";
import {
  canRetry,
  IndexedDbRejectedChangesPersistence,
  InMemoryRejectedChangesPersistence,
  RejectedChanges,
  type RejectedChange,
  type RejectedChangeHandlers,
} from "@/lib/client/backend/rejected-changes";
import type { QueuedMutation, QueuedProcedureCall } from "@/lib/server/data-store/in-memory/mutation-queue";
import type { ConflictRecord } from "@/lib/server/data-store/in-memory/reconcile-engine";
import { QUEUED_PROCEDURES } from "@/lib/shared/sync/queued-procedures";

const row: QueuedMutation = { mutationId: "r1", entity: "invoice", kind: "update", row: { id: "i1" }, baseVersion: 2, enqueuedAt: 0 };
const call: QueuedProcedureCall = {
  type: "procedure", mutationId: "p1", path: "billingRun.createFinal", input: { matterId: "m" }, codeVersion: "v", touches: [], enqueuedAt: 0,
};
const conflict = (mutation: QueuedMutation | QueuedProcedureCall, reason = "stale", retryable = true): ConflictRecord =>
  ({ mutation, conflictClass: "surface", reason, current: { id: "i1", version: 5 }, retryable });

/** Synkens handlers, med en logg över vad de gjorde. */
function handlers(log: string[] = []): RejectedChangeHandlers {
  return {
    retry: async (c) => { log.push(`retry:${c.id}`); },
    restore: async (c) => { log.push(`restore:${c.id}`); },
  };
}

describe("RejectedChanges", () => {
  it("sparar avvisningar med svensk beskrivning, skäl och serverns läge", async () => {
    const store = new RejectedChanges();
    await store.record([conflict(row), conflict(call, "Posterna är redan fakturerade.")], 1000);
    expect(store.list()).toEqual([
      { id: "r1", rejectedAt: 1000, label: "Ändring av faktura", reason: "stale", entry: row, current: { id: "i1", version: 5 }, retryable: true },
      { id: "p1", rejectedAt: 1000, label: "Slutfaktura", reason: "Posterna är redan fakturerade.", entry: call, current: { id: "i1", version: 5 }, retryable: true },
    ]);
  });

  it("samma ändring sparas bara en gång; tomma omgångar ändrar inget", async () => {
    const persistence = new InMemoryRejectedChangesPersistence();
    const add = vi.spyOn(persistence, "add");
    const store = new RejectedChanges(persistence);
    await store.record([conflict(row)]);
    await store.record([conflict(row)]);
    await store.record([]);
    expect(store.list()).toHaveLength(1);
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("kasta (#1348): serverns läge återställs först, sedan tas ändringen bort", async () => {
    const store = new RejectedChanges();
    await store.record([conflict(row)]);
    const log: string[] = [];
    store.setHandlers(handlers(log));
    await store.discard("r1");
    expect(log).toEqual(["restore:r1"]);
    expect(store.list()).toEqual([]);
    await store.discard("finns-inte"); // no-op
    expect(log).toEqual(["restore:r1"]);
  });

  it("kasta när servern inte nås → felet syns och ändringen ligger kvar", async () => {
    const store = new RejectedChanges();
    await store.record([conflict(row)]);
    await expect(store.discard("r1")).rejects.toThrow(/Ingen synk mot servern/);
    store.setHandlers({ ...handlers(), restore: () => Promise.reject(new Error("Failed to fetch")) });
    await expect(store.discard("r1")).rejects.toThrow("Failed to fetch");
    expect(store.list()).toHaveLength(1);
  });

  it("försök igen: tas bort och köas via den registrerade synken", async () => {
    const store = new RejectedChanges();
    await store.record([conflict(call)]);
    const log: string[] = [];
    const unregister = store.setHandlers(handlers(log));
    await store.retry("p1");
    expect(log).toEqual(["retry:p1"]);
    expect(store.list()).toEqual([]);
    unregister();
    await store.retry("finns-inte"); // no-op
  });

  it("försök igen tar bort ändringen INNAN den köas — en ny avvisning med samma id sparas", async () => {
    const store = new RejectedChanges();
    await store.record([conflict(row)], 1);
    store.setHandlers({ ...handlers(), retry: async (c) => { await store.record([conflict(c.entry, "stale igen")], 2); } });
    await store.retry("r1");
    expect(store.list()).toMatchObject([{ id: "r1", reason: "stale igen", rejectedAt: 2 }]);
  });

  it("försök igen som inte går att köa → ändringen läggs tillbaka och felet syns", async () => {
    const store = new RejectedChanges();
    await store.record([conflict(row)]);
    store.setHandlers({ ...handlers(), retry: () => Promise.reject(new Error("kön är full")) });
    await expect(store.retry("r1")).rejects.toThrow("kön är full");
    expect(store.list().map((c) => c.id)).toEqual(["r1"]);
  });

  it("försök igen utan synk mot servern → tydligt fel, ändringen ligger kvar", async () => {
    const store = new RejectedChanges();
    await store.record([conflict(row)]);
    await expect(store.retry("r1")).rejects.toThrow(/Ingen synk mot servern/);
    expect(store.list()).toHaveLength(1);
  });

  it("försök igen med en ändring som avvisas igen (#1348) → fel, ingenting köas", async () => {
    const store = new RejectedChanges();
    await store.record([conflict(call, "Posterna är redan fakturerade.", false)]);
    const log: string[] = [];
    store.setHandlers(handlers(log));
    await expect(store.retry("p1")).rejects.toThrow(/avvisas igen/);
    expect(log).toEqual([]);
    expect(store.list()).toHaveLength(1);
  });

  it("en gammal avregistrering rör inte en nyare synk", async () => {
    const store = new RejectedChanges();
    await store.record([conflict(row)]);
    const first = store.setHandlers(handlers());
    const log: string[] = [];
    store.setHandlers(handlers(log));
    first();
    await store.retry("r1");
    expect(log).toEqual(["retry:r1"]);
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

describe("canRetry (#1348)", () => {
  const saved = (over: Partial<RejectedChange>): RejectedChange =>
    ({ id: "x", rejectedAt: 0, label: "", reason: "", entry: { ...row, entity: "task" }, ...over });

  it("motorns svar gäller när det finns", () => {
    expect(canRetry(saved({ retryable: false, current: { id: "i1" } }))).toBe(false);
    expect(canRetry(saved({ retryable: true }))).toBe(true);
  });

  it("sparad före fältet → bara en versionskonflikt på en rad radkön får skriva", () => {
    expect(canRetry(saved({ current: { id: "i1" } }))).toBe(true);
    expect(canRetry(saved({}))).toBe(false);
    expect(canRetry(saved({ entry: row, current: { id: "i1" } }))).toBe(false); // faktura: procedurägd
    expect(canRetry(saved({ entry: call, current: { id: "i1" } }))).toBe(false);
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
