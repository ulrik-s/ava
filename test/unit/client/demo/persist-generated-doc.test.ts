/**
 * Tester för `persistGeneratedDoc`. Mockar cache, IndexedDB-blob-storen och de
 * dynamiskt importerade FSA-modulerna. Verifierar: stash anropas, FSA-skrivning
 * sker bara när en handle finns (annars no-op), bytes persisteras till IndexedDB
 * (`saveGeneratedDocBlob`, ADR 0016 / #420 — ersätter det gamla slab-eventet),
 * och att FSA-fel sväljs (kastar inte).
 */
import { describe, it, expect, vi, beforeEach } from "vitest-compat";

import { persistGeneratedDoc } from "@/lib/client/demo/persist-generated-doc";

const stashMock = vi.fn();
const loadHandleMock = vi.fn();
const writeFileMock = vi.fn(async () => {});
const saveBlobMock = vi.fn(async () => {});
const cacheMock = vi.fn(async (_id: string, _sha: string, _bytes: Uint8Array) => {});

vi.mock("@/lib/client/demo/generated-doc-cache", () => ({
  stashGeneratedDoc: (...a: unknown[]) => stashMock(...a),
}));
vi.mock("@/lib/client/demo/generated-doc-idb", () => ({
  saveGeneratedDocBlob: (...a: unknown[]) => saveBlobMock(...a),
}));
vi.mock("@/lib/client/backend/content-cache", () => ({
  DocumentContentCache: class { cache = cacheMock; },
}));
vi.mock("@/lib/client/fsa/handle-store", () => ({
  loadHandle: (...a: unknown[]) => loadHandleMock(...a),
}));
vi.mock("@/lib/client/fsa/fs-adapter", () => ({
  FsaIsoGitAdapter: class { constructor(_h: unknown) {} writeFile = writeFileMock; },
}));

const BYTES = new Uint8Array([72, 105]); // "Hi"
const DOC = { id: "d1", storagePath: "documents/d1.pdf", fileName: "d1.pdf", mimeType: "application/pdf", bytes: BYTES };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("persistGeneratedDoc", () => {
  it("stashar, hoppar FSA utan handle, och persisterar blobben till IndexedDB", async () => {
    loadHandleMock.mockResolvedValue(null);
    await persistGeneratedDoc(DOC);
    expect(stashMock).toHaveBeenCalledWith("d1", BYTES, "application/pdf", "d1.pdf");
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(saveBlobMock).toHaveBeenCalledWith({
      id: "d1",
      storagePath: "documents/d1.pdf",
      fileName: "d1.pdf",
      mimeType: "application/pdf",
      bytes: BYTES,
    });
  });

  it("skriver till FSA-working-copyn när en handle finns", async () => {
    loadHandleMock.mockResolvedValue({});
    await persistGeneratedDoc(DOC);
    expect(writeFileMock).toHaveBeenCalledWith("/documents/d1.pdf", BYTES);
  });

  it("sväljer FSA-skrivfel (kastar inte, blobben persisteras ändå)", async () => {
    loadHandleMock.mockResolvedValue({});
    writeFileMock.mockRejectedValueOnce(new Error("disk full"));
    await expect(persistGeneratedDoc(DOC)).resolves.toBeUndefined();
    expect(saveBlobMock).toHaveBeenCalledTimes(1);
  });

  it("köar innehållet för upload till servern (#1143) — pending i DocumentContentCache", async () => {
    loadHandleMock.mockResolvedValue(null);
    const had = "indexedDB" in globalThis;
    Reflect.set(globalThis, "indexedDB", Reflect.get(globalThis, "indexedDB") ?? {});
    try {
      await persistGeneratedDoc(DOC);
    } finally {
      if (!had) Reflect.deleteProperty(globalThis, "indexedDB");
    }
    const { sha256Hex } = await import("@/lib/shared/content-address");
    expect(cacheMock).toHaveBeenCalledWith("d1", await sha256Hex(BYTES), BYTES);
  });

  it("kö-fel sväljs — sparandet lyckas ändå (bytes finns kvar i IndexedDB för räddningen)", async () => {
    loadHandleMock.mockResolvedValue(null);
    cacheMock.mockRejectedValueOnce(new Error("quota"));
    const had = "indexedDB" in globalThis;
    Reflect.set(globalThis, "indexedDB", Reflect.get(globalThis, "indexedDB") ?? {});
    try {
      await expect(persistGeneratedDoc(DOC)).resolves.toBeUndefined();
    } finally {
      if (!had) Reflect.deleteProperty(globalThis, "indexedDB");
    }
    expect(saveBlobMock).toHaveBeenCalled();
  });
});
