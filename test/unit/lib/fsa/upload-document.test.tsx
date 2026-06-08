/**
 * Tester för `uploadDocumentToFsa`.
 *
 */

import { describe, it, expect, vi } from "vitest-compat";
import { uploadDocumentToFsa } from "@/lib/client/fsa/upload-document";

interface MockFs {
  writeFile: ReturnType<typeof vi.fn>;
}

vi.mock("@/lib/client/fsa/fs-adapter", () => ({
  FsaIsoGitAdapter: vi.fn().mockImplementation(function (this: MockFs): MockFs {
    this.writeFile = vi.fn().mockResolvedValue(undefined);
    return this;
  }),
}));

import { FsaIsoGitAdapter } from "@/lib/client/fsa/fs-adapter";

describe("uploadDocumentToFsa", () => {
  it("genererar id + skriver fil till documents/content/<id>.<ext>", async () => {
    const handle = {} as FileSystemDirectoryHandle;
    const file = new File(["%PDF-1.4 fake bytes"], "test.pdf", { type: "application/pdf" });
    const result = await uploadDocumentToFsa({
      handle, matterId: "m1", file,
      generateId: () => "d-test-1",
    });
    expect(result).toEqual({
      id: "d-test-1",
      fileName: "test.pdf",
      mimeType: "application/pdf",
      sizeBytes: file.size,
      storagePath: "documents/content/d-test-1.pdf",
    });
    const instance = (FsaIsoGitAdapter as unknown as { mock: { results: { value: MockFs }[] } }).mock.results.at(-1)!.value;
    expect(instance.writeFile).toHaveBeenCalled();
    const [path] = instance.writeFile.mock.calls.at(-1)!;
    expect(path).toBe("/documents/content/d-test-1.pdf");
  });

  it("hanterar fil utan extension → .bin", async () => {
    const handle = {} as FileSystemDirectoryHandle;
    const file = new File(["data"], "noext", { type: "application/octet-stream" });
    const result = await uploadDocumentToFsa({
      handle, matterId: "m1", file,
      generateId: () => "d2",
    });
    expect(result.storagePath).toBe("documents/content/d2.bin");
  });

  it("normaliserar extension till lowercase", async () => {
    const handle = {} as FileSystemDirectoryHandle;
    const file = new File(["data"], "Document.PDF", { type: "application/pdf" });
    const result = await uploadDocumentToFsa({
      handle, matterId: "m1", file,
      generateId: () => "d3",
    });
    expect(result.storagePath).toBe("documents/content/d3.pdf");
  });

  it("fallback mimeType till application/octet-stream när fil saknar typ", async () => {
    const handle = {} as FileSystemDirectoryHandle;
    const file = new File(["data"], "x.dat", { type: "" });
    const result = await uploadDocumentToFsa({
      handle, matterId: "m1", file,
      generateId: () => "d4",
    });
    expect(result.mimeType).toBe("application/octet-stream");
  });
});
