/**
 * Tester för `generated-doc-idb` (ADR 0016 / #420) — IndexedDB-persistens av
 * klient-genererade dok-blobbar som ersätter MemFs-slaben. Testas mot
 * fake-indexeddb (happy-dom saknar IndexedDB) via en injicerad global
 * `indexedDB`; --isolate håller mutationen i denna fil.
 */

import { IDBFactory } from "fake-indexeddb";
import { describe, it, expect, beforeEach, afterEach } from "vitest-compat";
import {
  saveGeneratedDocBlob,
  loadAllGeneratedDocBlobs,
  type StoredDocBlob,
} from "@/lib/client/demo/generated-doc-idb";

let prev: PropertyDescriptor | undefined;

beforeEach(() => {
  prev = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", { value: new IDBFactory(), configurable: true, writable: true });
});

afterEach(() => {
  if (prev) Object.defineProperty(globalThis, "indexedDB", prev);
  else delete (globalThis as { indexedDB?: unknown }).indexedDB;
});

const doc = (id: string): StoredDocBlob => ({
  id,
  storagePath: `documents/content/${id}.pdf`,
  fileName: `${id}.pdf`,
  mimeType: "application/pdf",
  bytes: new Uint8Array([37, 80, 68, 70]), // %PDF
});

describe("generated-doc-idb", () => {
  it("tom DB → loadAll returnerar []", async () => {
    expect(await loadAllGeneratedDocBlobs()).toEqual([]);
  });

  it("save → loadAll round-trippar blobben (bytes bevarade via structured clone)", async () => {
    await saveGeneratedDocBlob(doc("d1"));
    const all = await loadAllGeneratedDocBlobs();
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe("d1");
    expect(all[0]!.mimeType).toBe("application/pdf");
    expect(Array.from(all[0]!.bytes)).toEqual([37, 80, 68, 70]);
  });

  it("flera blobbar + överskrivning per id", async () => {
    await saveGeneratedDocBlob(doc("a"));
    await saveGeneratedDocBlob(doc("b"));
    await saveGeneratedDocBlob({ ...doc("a"), fileName: "ny.pdf" });
    const all = await loadAllGeneratedDocBlobs();
    expect(all).toHaveLength(2);
    expect(all.find((d) => d.id === "a")!.fileName).toBe("ny.pdf");
  });

  it("utan IndexedDB i miljön → save är no-op, loadAll []", async () => {
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
    await expect(saveGeneratedDocBlob(doc("x"))).resolves.toBeUndefined();
    expect(await loadAllGeneratedDocBlobs()).toEqual([]);
  });
});
