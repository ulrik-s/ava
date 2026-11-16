/**
 * Uppladdningen med målmapp och visningsnamn (#1614): samma väg som
 * **+ Ladda upp**, men `document.register` får `folderId` och det valda namnet
 * (städat, ändelsen behålls) — även i FSA-grenen där filen skrivs lokalt.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { asId } from "@/lib/shared/schemas/ids";

let fsaHandle: object | null = null;
vi.mock("@/lib/client/fsa/handle-store", () => ({
  isFsaSupported: vi.fn(() => true),
  loadHandle: vi.fn(() => Promise.resolve(fsaHandle)),
}));
const uploadDocumentToFsa = vi.fn(({ file }: { file: File }) => Promise.resolve({
  id: "fsa-1", fileName: file.name, mimeType: file.type, sizeBytes: file.size, storagePath: "documents/content/fsa-1.pdf",
}));
vi.mock("@/lib/client/fsa/upload-document", () => ({ uploadDocumentToFsa }));

const saveDocumentContent = vi.fn(() => Promise.resolve("sha"));
vi.mock("@/lib/client/backend/save-document-content", () => ({ saveDocumentContent }));
const suggestFromBytes = vi.fn(() => Promise.resolve());
vi.mock("@/lib/client/backend/suggest-from-bytes", () => ({ suggestFromBytes }));
const jobQueueEnqueue = vi.fn();
vi.mock("@/lib/client/jobs/job-queue", () => ({ jobQueue: { enqueue: jobQueueEnqueue } }));
const enqueueTextExtraction = vi.fn(() => Promise.resolve());
vi.mock("@/lib/client/jobs/enqueue-text-extraction", () => ({ enqueueTextExtraction }));
vi.mock("@/lib/client/capabilities/use-capabilities", () => ({ useCapabilities: () => ({ jobs: false }) }));

const treeInvalidate = vi.fn(() => Promise.resolve());
vi.mock("@/lib/client/trpc", () => ({
  trpc: { useUtils: () => ({ client: {}, document: { tree: { invalidate: treeInvalidate } } }) },
}));

const { useFileUpload, savedFileName, makePlaceholderDoc } = await import("@/components/documents/_use-file-upload");

const matterId = asId<"MatterId">("m1");
const folderId = asId<"DocumentFolderId">("f1");
const pdf = (name: string) => new File(["%PDF"], name, { type: "application/pdf" });

function setup(createFromFsa = vi.fn(() => Promise.resolve())) {
  const fileInputRef = { current: null };
  const hook = renderHook(() => useFileUpload({ matterId, mutations: { createFromFsa }, fileInputRef }));
  return { ...hook, createFromFsa };
}

beforeEach(() => {
  vi.clearAllMocks();
  fsaHandle = null;
});

describe("savedFileName", () => {
  it("utan valt namn: filens eget", () => expect(savedFileName(pdf("skiss.pdf"))).toBe("skiss.pdf"));
  it("valt namn får ändelsen", () => expect(savedFileName(pdf("skiss.pdf"), "Avtal")).toBe("Avtal.pdf"));
  it("tomt valt namn: filens eget", () => expect(savedFileName(pdf("skiss.pdf"), " ")).toBe("skiss.pdf"));
});

describe("makePlaceholderDoc", () => {
  it("utan mål: roten och filens namn", () => {
    expect(makePlaceholderDoc({ id: "p", file: pdf("a.pdf"), matterId })).toMatchObject({ fileName: "a.pdf", folderId: null });
  });
  it("med mål och namn", () => {
    expect(makePlaceholderDoc({ id: "p", file: pdf("a.pdf"), matterId, fileName: "B.pdf", folderId }))
      .toMatchObject({ fileName: "B.pdf", folderId });
  });
});

describe("useFileUpload — enqueueUpload (namnrutan)", () => {
  it("registrerar med valt namn och målmapp (server-first)", async () => {
    const { result, createFromFsa } = setup();
    await act(() => result.current.enqueueUpload(pdf("skiss.pdf"), { folderId, fileName: "Avtal" }));
    expect(createFromFsa).toHaveBeenCalledWith(expect.objectContaining({ matterId, folderId, fileName: "Avtal.pdf" }));
    expect(saveDocumentContent).toHaveBeenCalled();
    expect(suggestFromBytes).toHaveBeenCalledWith({}, expect.anything(), expect.objectContaining({ fileName: "Avtal.pdf" }));
    expect(enqueueTextExtraction).toHaveBeenCalledWith(expect.objectContaining({ fileName: "Avtal.pdf" }));
    expect(result.current.pendingUploads).toEqual([]);
  });

  it("FSA-grenen: det valda namnet når register och klassificeringen", async () => {
    fsaHandle = {};
    const { result, createFromFsa } = setup();
    await act(() => result.current.enqueueUpload(pdf("skiss.pdf"), { folderId, fileName: "Avtal" }));
    expect(uploadDocumentToFsa).toHaveBeenCalled();
    expect(createFromFsa).toHaveBeenCalledWith(expect.objectContaining({ id: "fsa-1", folderId, fileName: "Avtal.pdf" }));
    expect(saveDocumentContent).not.toHaveBeenCalled();
    expect(jobQueueEnqueue).toHaveBeenCalledWith("classify-document", "Analyserar Avtal.pdf", expect.objectContaining({ fileName: "Avtal.pdf" }));
  });

  it("den optimistiska raden visas i målmappen med valt namn medan uppladdningen pågår", async () => {
    let release = (): void => {};
    const createFromFsa = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const { result } = setup(createFromFsa);
    let done: Promise<void> = Promise.resolve();
    act(() => { done = result.current.enqueueUpload(pdf("skiss.pdf"), { folderId, fileName: "Avtal" }); });
    await waitFor(() => expect(createFromFsa).toHaveBeenCalled());
    expect(result.current.pendingUploads).toEqual([expect.objectContaining({ folderId, fileName: "Avtal.pdf" })]);
    expect(result.current.uploading).toBe(true);
    await act(async () => { release(); await done; });
    expect(result.current.pendingUploads).toEqual([]);
    expect(result.current.uploading).toBe(false);
  });

  it("utan mapp: inget folderId till register", async () => {
    const { result, createFromFsa } = setup();
    await act(() => result.current.enqueueUpload(pdf("skiss.pdf"), { folderId: null, fileName: "skiss" }));
    expect(createFromFsa.mock.calls[0]?.[0]).not.toHaveProperty("folderId");
  });

  it("filerna laddas upp en i taget, i köordning", async () => {
    const order: string[] = [];
    const createFromFsa = vi.fn((input: { fileName: string }) => { order.push(input.fileName); return Promise.resolve(); });
    const { result } = setup(createFromFsa);
    await act(async () => {
      void result.current.enqueueUpload(pdf("a.pdf"), { fileName: "A" });
      await result.current.enqueueUpload(pdf("b.pdf"), { fileName: "B" });
    });
    expect(order).toEqual(["A.pdf", "B.pdf"]);
  });

  it("fel per fil samlas i felbannern", async () => {
    const createFromFsa = vi.fn()
      .mockRejectedValueOnce(new Error("för stor"))
      .mockRejectedValueOnce("nätverk");
    const { result } = setup(createFromFsa);
    await act(() => result.current.enqueueUpload(pdf("a.pdf"), { fileName: "A" }));
    await act(() => result.current.enqueueUpload(pdf("b.pdf"), { fileName: "B" }));
    expect(result.current.uploadError).toBe("a.pdf: för stor\nb.pdf: nätverk");
    expect(result.current.pendingUploads).toEqual([]);
  });

  it("ett fel före register tar bort placeholder-raden", async () => {
    fsaHandle = {};
    uploadDocumentToFsa.mockRejectedValueOnce(new Error("disk full"));
    const { result, createFromFsa } = setup();
    await act(() => result.current.enqueueUpload(pdf("a.pdf"), { fileName: "A" }));
    expect(createFromFsa).not.toHaveBeenCalled();
    expect(result.current.pendingUploads).toEqual([]);
    expect(result.current.uploadError).toBe("a.pdf: disk full");
  });
});

describe("useFileUpload — + Ladda upp", () => {
  it("utan filer händer inget", async () => {
    const { result, createFromFsa } = setup();
    await act(() => result.current.handleFileUpload({ target: { files: null } }));
    expect(createFromFsa).not.toHaveBeenCalled();
  });

  it("nollställer felbannern och filväljaren, roten och filens eget namn", async () => {
    const createFromFsa = vi.fn().mockRejectedValueOnce(new Error("gammalt fel")).mockResolvedValue(undefined);
    const fileInputRef = { current: { value: "C:\\fakepath\\a.pdf" } };
    const { result } = renderHook(() => useFileUpload({ matterId, mutations: { createFromFsa }, fileInputRef }));
    await act(() => result.current.enqueueUpload(pdf("x.pdf"), { fileName: "X" }));
    expect(result.current.uploadError).toBe("x.pdf: gammalt fel");
    await act(() => result.current.handleFileUpload({ target: { files: [pdf("a.pdf")] } }));
    expect(result.current.uploadError).toBeNull();
    expect(fileInputRef.current.value).toBe("");
    const input: unknown = createFromFsa.mock.calls[1]?.[0];
    expect(input).toMatchObject({ fileName: "a.pdf" });
    expect(input).not.toHaveProperty("folderId");
  });
});
