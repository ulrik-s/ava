/**
 * Integration: hela upload-flödet mot en in-memory FSA-mock.
 *
 * Verifierar END-to-END:
 *   1. uploadDocumentToFsa skriver PDF-bytes till `documents/content/<id>.<ext>`
 *   2. makeFsaWriteBack på 'document.create'-event skriver
 *      `documents/<id>.json` med metadata
 *
 * Skiljer sig från upload-document.test.tsx (som mock:ar FsaIsoGitAdapter
 * — den exercise:ar inte den faktiska skrivvägen). Den här testen
 * fångar bug:s där PDF:n inte hamnar i FSA-folder pga path/dir-fel.
 *
 */

import { describe, it, expect } from "vitest-compat";
import { uploadDocumentToFsa } from "@/lib/client/fsa/upload-document";
import { makeFsaWriteBack } from "@/lib/client/firma/fsa-write-back";
import { makeFakeFsa } from "../../../helpers/fake-fsa";

describe("Document upload — integration mot fake FSA", () => {
  it("uploadDocumentToFsa skriver PDF-bytes till rätt fil", async () => {
    const fsa = makeFakeFsa();
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34]); // "%PDF-1.4"
    const file = new File([bytes as unknown as BlobPart], "stamning.pdf", { type: "application/pdf" });

    const result = await uploadDocumentToFsa({
      handle: fsa.root,
      matterId: "m1",
      file,
      generateId: () => "d-1",
    });

    expect(result.storagePath).toBe("documents/content/d-1.pdf");

    const written = fsa.readFile("documents/content/d-1.pdf");
    expect(written).not.toBeNull();
    expect(Array.from(written!)).toEqual(Array.from(bytes));
  });

  it("makeFsaWriteBack skriver documents/<id>.json vid document.create", async () => {
    const fsa = makeFakeFsa();
    const writeBack = makeFsaWriteBack({ handle: fsa.root });

    await writeBack({
      entity: "document",
      kind: "create",
      row: {
        id: "d-1",
        matterId: "m1",
        fileName: "stamning.pdf",
        mimeType: "application/pdf",
        sizeBytes: 8,
        storagePath: "documents/content/d-1.pdf",
        analysisStatus: "PENDING",
        organizationId: "org-1",
      },
    });

    const jsonBytes = fsa.readFile("documents/d-1.json");
    expect(jsonBytes).not.toBeNull();
    const parsed = JSON.parse(new TextDecoder().decode(jsonBytes!));
    expect(parsed).toMatchObject({
      id: "d-1",
      storagePath: "documents/content/d-1.pdf",
      analysisStatus: "PENDING",
    });
  });

  it("hela upload-flödet: PDF + JSON existerar bredvid varandra efter upload+register", async () => {
    const fsa = makeFakeFsa();
    const file = new File(["pdf-bytes"], "stamning.pdf", { type: "application/pdf" });

    // 1. uploadDocumentToFsa skriver PDF
    const result = await uploadDocumentToFsa({
      handle: fsa.root, matterId: "m1", file, generateId: () => "d-1",
    });

    // 2. writeBack skriver JSON (vad register-mutation triggar)
    const writeBack = makeFsaWriteBack({ handle: fsa.root });
    await writeBack({
      entity: "document", kind: "create",
      row: {
        id: result.id, matterId: "m1",
        fileName: result.fileName, mimeType: result.mimeType,
        sizeBytes: result.sizeBytes, storagePath: result.storagePath,
      },
    });

    const allFiles = fsa.listAllFiles().sort();
    expect(allFiles).toEqual([
      "documents/content/d-1.pdf",
      "documents/d-1.json",
    ]);
  });

  it("uppdatering via writeBack overskriver befintlig JSON (classify-flödet)", async () => {
    const fsa = makeFakeFsa();
    const writeBack = makeFsaWriteBack({ handle: fsa.root });

    // Initial create
    await writeBack({
      entity: "document", kind: "create",
      row: { id: "d-1", documentType: null, analysisStatus: "PENDING" },
    });
    const before = JSON.parse(new TextDecoder().decode(fsa.readFile("documents/d-1.json")!));
    expect(before.documentType).toBeNull();

    // Classify-jobbet's update via dispatchAnalyze → updateMetadata
    await writeBack({
      entity: "document", kind: "update",
      row: { id: "d-1", documentType: "STAMNING", analysisStatus: "PENDING" },
      previous: { id: "d-1", documentType: null, analysisStatus: "PENDING" },
    });
    const after = JSON.parse(new TextDecoder().decode(fsa.readFile("documents/d-1.json")!));
    expect(after.documentType).toBe("STAMNING");
  });
});
