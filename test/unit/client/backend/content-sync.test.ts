/**
 * Tester för byte-synk-orkestreringen (#518, ADR 0023) — `runContentSync`.
 * Dep-injicerad, ingen IndexedDB/tRPC: verifierar dedup (hoppa sha:n servern
 * har), upload av saknade, markUploaded alltid, samt no-op vid tom pending.
 */

import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest-compat";
import { DocumentContentCache } from "@/lib/client/backend/content-cache";
import { runContentSync, syncDocumentContent } from "@/lib/client/backend/content-sync";
import { base64ToBytes, contentStoragePath, sha256Hex } from "@/lib/shared/content-address";

describe("runContentSync", () => {
  it("tom pending → no-op", async () => {
    const upload = vi.fn();
    const out = await runContentSync({
      pending: async () => [], missing: async () => [], getBytes: async () => null, upload, markUploaded: vi.fn(),
    });
    expect(out).toEqual([]);
    expect(upload).not.toHaveBeenCalled();
  });

  it("laddar bara upp sha:n servern saknar (dedup) + markUploaded för alla", async () => {
    const pending = [
      { documentId: "d1", sha: "aaa" },
      { documentId: "d2", sha: "bbb" }, // servern har redan denna
    ];
    const upload = vi.fn(async () => {});
    const markUploaded = vi.fn(async () => {});
    const out = await runContentSync({
      pending: async () => pending,
      missing: async () => [contentStoragePath("aaa")], // bara aaa saknas
      getBytes: async (sha) => new Uint8Array([sha === "aaa" ? 1 : 2]),
      upload,
      markUploaded,
    });
    expect(out).toEqual(["aaa"]);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith("d1", new Uint8Array([1]));
    expect(markUploaded).toHaveBeenCalledTimes(2); // båda rensas ur pending
  });

  it("saknad blob (getBytes null) → hoppa upload men markUploaded", async () => {
    const upload = vi.fn(async () => {});
    const markUploaded = vi.fn(async () => {});
    const out = await runContentSync({
      pending: async () => [{ documentId: "d1", sha: "ccc" }],
      missing: async () => [contentStoragePath("ccc")],
      getBytes: async () => null,
      upload,
      markUploaded,
    });
    expect(out).toEqual([]);
    expect(upload).not.toHaveBeenCalled();
    expect(markUploaded).toHaveBeenCalledWith("d1");
  });
});

describe("syncDocumentContent (wirad mot tRPC + cache)", () => {
  it("laddar upp pending blob via uploadContent + rensar pending", async () => {
    const cache = new DocumentContentCache(new IDBFactory());
    const bytes = new Uint8Array([5, 6, 7]);
    const sha = await sha256Hex(bytes);
    await cache.cache("d1", sha, bytes);

    const uploads: Array<{ documentId: string; contentBase64: string }> = [];
    const client = {
      document: {
        missingContent: { query: async (i: { storagePaths: string[] }) => ({ missing: i.storagePaths }) },
        uploadContent: { mutate: async (i: { documentId: string; contentBase64: string }) => { uploads.push(i); } },
      },
    };

    const out = await syncDocumentContent(client, cache);
    expect(out).toEqual([sha]);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.documentId).toBe("d1");
    expect(Array.from(base64ToBytes(uploads[0]!.contentBase64))).toEqual([5, 6, 7]);
    expect(await cache.pendingUploads()).toEqual([]); // rensad efter upload
  });

  it("servern har redan blobben → ingen upload, pending rensas", async () => {
    const cache = new DocumentContentCache(new IDBFactory());
    await cache.cache("d2", await sha256Hex(new Uint8Array([1])), new Uint8Array([1]));
    const uploads: unknown[] = [];
    const client = {
      document: {
        missingContent: { query: async () => ({ missing: [] }) }, // servern har allt
        uploadContent: { mutate: async (i: unknown) => { uploads.push(i); } },
      },
    };
    expect(await syncDocumentContent(client, cache)).toEqual([]);
    expect(uploads).toHaveLength(0);
    expect(await cache.pendingUploads()).toEqual([]);
  });
});
