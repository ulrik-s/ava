/**
 * Test för document.uploadContent / downloadContent (#518, ADR 0023).
 * Innehålls-adresserad lagring (sha256), repekning av storagePath, re-klassning,
 * download-roundtrip + org-scope. Kör mot riktig in-memory-store; content-port
 * är en Map-backad fake.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import type { DemoSource } from "@/lib/server/data-store/DemoDataStore";
import type { IDataStore } from "@/lib/server/data-store/IDataStore";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { documentRouter } from "@/lib/server/routers/document";
import { bytesToBase64, contentStoragePath, sha256Hex } from "@/lib/shared/content-address";
import { prebakeJoins } from "@/lib/shared/demo-source";

vi.mock("@/lib/server/services/meilisearch", () => ({
  searchDocuments: vi.fn(),
  removeDocument: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/server/services/document-analysis", () => ({
  analyzeDocument: vi.fn().mockResolvedValue(undefined),
}));

const ORG = "org-a";

function makeCaller(orgId = ORG) {
  const source = prebakeJoins({
    matters: [{ id: "m1", organizationId: ORG, matterNumber: "2026-1", title: "T" }],
    documentFolders: [],
    documents: [{
      id: "d1", organizationId: ORG, matterId: "m1", fileName: "avtal.pdf",
      mimeType: "application/pdf", sizeBytes: 3, storagePath: "documents/content/old", version: 1,
    }],
  } as DemoSource);
  const store = new LocalStore(source, async () => {});
  const repos = buildInMemoryRepositories(store as unknown as IDataStore);
  const blobs = new Map<string, Uint8Array>();
  const analyze = vi.fn().mockResolvedValue(undefined);
  const ports = {
    email: { send: vi.fn() },
    paymentScanner: { scan: vi.fn() },
    documentAnalyzer: { analyze },
    searchIndex: { search: vi.fn(), upsert: vi.fn(), remove: vi.fn().mockResolvedValue(undefined) },
    content: {
      write: async (p: string, b: Uint8Array) => { blobs.set(p, b); },
      read: async (p: string) => blobs.get(p) ?? null,
      exists: async (p: string) => blobs.has(p),
    },
  };
  const ctx = { user: { id: "u1", email: "a@b.se", name: "T", role: "LAWYER", organizationId: orgId }, dataStore: store, repos, orgId, ports };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { caller: documentRouter.createCaller(ctx as any), blobs, analyze };
}

beforeEach(() => vi.clearAllMocks());

describe("document.uploadContent", () => {
  it("lagrar innehålls-adresserat, repekar storagePath + triggar klassning", async () => {
    const { caller, blobs, analyze } = makeCaller();
    const bytes = new Uint8Array([1, 2, 3]);
    await caller.uploadContent({ documentId: "d1", contentBase64: bytesToBase64(bytes) });

    const expectedPath = contentStoragePath(await sha256Hex(bytes));
    expect(Array.from(blobs.get(expectedPath)!)).toEqual([1, 2, 3]);
    expect(analyze).toHaveBeenCalledWith("d1");

    // storagePath repekad → downloadContent ger tillbaka samma bytes.
    const dl = await caller.downloadContent({ documentId: "d1" });
    expect(Array.from(Buffer.from(dl.contentBase64, "base64"))).toEqual([1, 2, 3]);
    expect(dl.mimeType).toBe("application/pdf");
  });

  it("identiskt innehåll → samma hash (dedup)", async () => {
    const { caller, blobs } = makeCaller();
    const b64 = bytesToBase64(new Uint8Array([9, 9]));
    await caller.uploadContent({ documentId: "d1", contentBase64: b64 });
    await caller.uploadContent({ documentId: "d1", contentBase64: b64 });
    expect(blobs.size).toBe(1); // samma sha → en blob
  });

  it("org-scope: dokument i annan org → NOT_FOUND", async () => {
    const { caller } = makeCaller("org-b");
    await expect(
      caller.uploadContent({ documentId: "d1", contentBase64: bytesToBase64(new Uint8Array([1])) }),
    ).rejects.toThrow();
  });
});

describe("document.downloadContent", () => {
  it("saknat innehåll på servern → NOT_FOUND", async () => {
    const { caller } = makeCaller();
    // Inget uppladdat → storagePath "documents/content/old" finns ej i content-store.
    await expect(caller.downloadContent({ documentId: "d1" })).rejects.toThrow(/saknas/i);
  });
});

describe("document.missingContent", () => {
  it("returnerar bara sökvägar servern saknar (byte-synk-dedup)", async () => {
    const { caller } = makeCaller();
    const bytes = new Uint8Array([7, 7]);
    await caller.uploadContent({ documentId: "d1", contentBase64: bytesToBase64(bytes) });
    const have = contentStoragePath(await sha256Hex(bytes));
    const res = await caller.missingContent({ storagePaths: [have, "documents/content/finns-ej"] });
    expect(res.missing).toEqual(["documents/content/finns-ej"]);
  });
});
