/**
 * Tester för `saveDocumentContent` (#518, ADR 0023) — spara-primitiven:
 * cacha (pending) + ladda upp via uploadContent. Fake-indexeddb + fake-klient.
 */

import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { DocumentContentCache } from "@/lib/client/backend/content-cache";
import { saveDocumentContent } from "@/lib/client/backend/save-document-content";
import { base64ToBytes, sha256Hex } from "@/lib/shared/content-address";

let cache: DocumentContentCache;
beforeEach(() => { cache = new DocumentContentCache(new IDBFactory()); });

describe("saveDocumentContent", () => {
  it("cachar bytes (pending) + laddar upp via uploadContent (base64)", async () => {
    const uploads: Array<{ documentId: string; contentBase64: string }> = [];
    const client = { document: { uploadContent: { mutate: async (i: { documentId: string; contentBase64: string }) => { uploads.push(i); } } } };
    const bytes = new Uint8Array([1, 2, 3, 4]);

    const sha = await saveDocumentContent(client, "doc-1", bytes, cache);

    expect(sha).toBe(await sha256Hex(bytes));
    // Pending → byte-synken laddar upp vid reconnect (offline-säkert).
    expect(await cache.pendingUploads()).toEqual([{ documentId: "doc-1", sha }]);
    expect(Array.from((await cache.getBytes(sha))!)).toEqual([1, 2, 3, 4]);
    // uploadContent anropad med rätt bytes.
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.documentId).toBe("doc-1");
    expect(Array.from(base64ToBytes(uploads[0]!.contentBase64))).toEqual([1, 2, 3, 4]);
  });
});
