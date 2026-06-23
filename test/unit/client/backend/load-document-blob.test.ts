/**
 * Tester för `loadDocumentBlob` (#518, ADR 0023) — öppna-primitiven:
 * cache-hit, download→cache (miss), och fel→null. Fake-indexeddb-cache +
 * fake tRPC-klient.
 */

import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { DocumentContentCache } from "@/lib/client/backend/content-cache";
import { loadDocumentBlob } from "@/lib/client/backend/load-document-blob";
import { asId } from "@/lib/shared/schemas/ids";

let cache: DocumentContentCache;
beforeEach(() => { cache = new DocumentContentCache(new IDBFactory()); });

const doc = { id: asId<"DocumentId">("d1"), storagePath: "documents/content/sha-abc", fileName: "avtal.pdf" };

function clientReturning(contentBase64: string, mimeType = "application/pdf") {
  return { document: { downloadContent: { query: vi.fn(async () => ({ contentBase64, mimeType })) } } };
}

describe("loadDocumentBlob", () => {
  it("cache-hit → Blob utan nätanrop", async () => {
    await cache.putBytes("sha-abc", new Uint8Array([1, 2, 3]));
    const client = clientReturning("");
    const blob = await loadDocumentBlob(client, doc, cache);
    expect(blob).not.toBeNull();
    expect(blob!.type).toBe("application/pdf");
    expect(Array.from(new Uint8Array(await blob!.arrayBuffer()))).toEqual([1, 2, 3]);
    expect(client.document.downloadContent.query).not.toHaveBeenCalled();
  });

  it("miss → download + cacha (nästa gång cache-hit)", async () => {
    // base64 av [9,9,9]
    const b64 = Buffer.from([9, 9, 9]).toString("base64");
    const client = clientReturning(b64);
    const blob = await loadDocumentBlob(client, doc, cache);
    expect(Array.from(new Uint8Array(await blob!.arrayBuffer()))).toEqual([9, 9, 9]);
    expect(client.document.downloadContent.query).toHaveBeenCalledWith({ documentId: "d1" });
    // Cachad nu → ingen ny query
    const client2 = clientReturning("");
    await loadDocumentBlob(client2, doc, cache);
    expect(client2.document.downloadContent.query).not.toHaveBeenCalled();
  });

  it("download-fel → null", async () => {
    const client = { document: { downloadContent: { query: vi.fn(async () => { throw new Error("404"); }) } } };
    expect(await loadDocumentBlob(client, doc, cache)).toBeNull();
  });
});
