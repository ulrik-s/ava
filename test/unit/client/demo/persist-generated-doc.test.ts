/**
 * Tester för `persistGeneratedDoc` (#27 — otestad). Mockar cache + de
 * dynamiskt importerade FSA-modulerna. Verifierar: stash anropas, FSA-skrivning
 * sker bara när en handle finns (annars no-op), CustomEvent med korrekt base64,
 * och att FSA-fel sväljs (kastar inte).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest-compat";

import { persistGeneratedDoc } from "@/lib/client/demo/persist-generated-doc";

const stashMock = vi.fn();
const loadHandleMock = vi.fn();
const writeFileMock = vi.fn(async () => {});

vi.mock("@/lib/client/demo/generated-doc-cache", () => ({
  stashGeneratedDoc: (...a: unknown[]) => stashMock(...a),
}));
vi.mock("@/lib/client/fsa/handle-store", () => ({
  loadHandle: (...a: unknown[]) => loadHandleMock(...a),
}));
vi.mock("@/lib/client/fsa/fs-adapter", () => ({
  FsaIsoGitAdapter: class { constructor(_h: unknown) {} writeFile = writeFileMock; },
}));

const BYTES = new Uint8Array([72, 105]); // "Hi" → base64 "SGk="
const DOC = { id: "d1", storagePath: "documents/d1.pdf", fileName: "d1.pdf", mimeType: "application/pdf", bytes: BYTES };

let events: CustomEvent[] = [];
const listener = (e: Event) => events.push(e as CustomEvent);

beforeEach(() => {
  vi.clearAllMocks();
  events = [];
  window.addEventListener("ava:generated-doc", listener);
});
afterEach(() => window.removeEventListener("ava:generated-doc", listener));

describe("persistGeneratedDoc", () => {
  it("stashar, hoppar FSA utan handle, och dispatchar event med base64", async () => {
    loadHandleMock.mockResolvedValue(null);
    await persistGeneratedDoc(DOC);
    expect(stashMock).toHaveBeenCalledWith("d1", BYTES, "application/pdf", "d1.pdf");
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0]!.detail).toEqual({ id: "d1", storagePath: "documents/d1.pdf", contentBase64: "SGk=" });
  });

  it("skriver till FSA-working-copyn när en handle finns", async () => {
    loadHandleMock.mockResolvedValue({});
    await persistGeneratedDoc(DOC);
    expect(writeFileMock).toHaveBeenCalledWith("/documents/d1.pdf", BYTES);
  });

  it("sväljer FSA-skrivfel (kastar inte, event dispatchas ändå)", async () => {
    loadHandleMock.mockResolvedValue({});
    writeFileMock.mockRejectedValueOnce(new Error("disk full"));
    await expect(persistGeneratedDoc(DOC)).resolves.toBeUndefined();
    expect(events).toHaveLength(1);
  });
});
