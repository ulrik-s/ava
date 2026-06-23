/**
 * Tester för `DocumentContentCache` (#518, ADR 0023) — IndexedDB byte-cache
 * (fake-indexeddb). Blob-roundtrip, pending-manifest, coalesce (senaste sha per
 * dokument), markUploaded.
 */

import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest-compat";
import { DocumentContentCache } from "@/lib/client/backend/content-cache";
import { asId } from "@/lib/shared/schemas/ids";

const docId = (s: string) => asId<"DocumentId">(s);

let cache: DocumentContentCache;
beforeEach(() => { cache = new DocumentContentCache(new IDBFactory()); });

describe("DocumentContentCache", () => {
  it("cachar bytes + listar pending + roundtrip", async () => {
    await cache.cache(docId("d1"), "sha-a", new Uint8Array([1, 2, 3]));
    expect(await cache.pendingUploads()).toEqual([{ documentId: "d1", sha: "sha-a" }]);
    expect(Array.from((await cache.getBytes("sha-a"))!)).toEqual([1, 2, 3]);
  });

  it("coalesce: ny sparning av samma dokument → bara senaste sha pending", async () => {
    await cache.cache(docId("d1"), "sha-v1", new Uint8Array([1]));
    await cache.cache(docId("d1"), "sha-v2", new Uint8Array([2]));
    expect(await cache.pendingUploads()).toEqual([{ documentId: "d1", sha: "sha-v2" }]);
    // Gamla blobben finns kvar i läs-cachen (immutabel), bara manifestet slogs ihop.
    expect(await cache.getBytes("sha-v1")).not.toBeNull();
  });

  it("markUploaded tar bort ur pending men behåller blobben", async () => {
    await cache.cache(docId("d1"), "sha-a", new Uint8Array([9]));
    await cache.markUploaded(docId("d1"));
    expect(await cache.pendingUploads()).toEqual([]);
    expect(await cache.getBytes("sha-a")).not.toBeNull();
  });

  it("getBytes för okänd sha → null", async () => {
    expect(await cache.getBytes("nope")).toBeNull();
  });
});
