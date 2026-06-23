/**
 * Integration: upload-flödet mot en in-memory FSA-mock.
 *
 * Verifierar att `uploadDocumentToFsa` skriver PDF-bytes till
 * `documents/content/<id>.<ext>` i FSA-foldern — fångar bug:s där PDF:n
 * inte hamnar i rätt fil pga path/dir-fel.
 *
 * (Den gamla `makeFsaWriteBack`-delen togs bort i #420 — JSON-projektions-
 * skrivningen via git-working-copy finns inte längre; metadata skrivs via
 * storens mutationer.)
 */

import { describe, it, expect } from "vitest-compat";
import { uploadDocumentToFsa } from "@/lib/client/fsa/upload-document";
import { asId } from "@/lib/shared/schemas/ids";
import { makeFakeFsa } from "../../../helpers/fake-fsa";

describe("Document upload — integration mot fake FSA", () => {
  it("uploadDocumentToFsa skriver PDF-bytes till rätt fil", async () => {
    const fsa = makeFakeFsa();
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34]); // "%PDF-1.4"
    const file = new File([bytes as unknown as BlobPart], "stamning.pdf", { type: "application/pdf" });

    const result = await uploadDocumentToFsa({
      handle: fsa.root,
      matterId: asId<"MatterId">("m1"),
      file,
      generateId: () => "d-1",
    });

    expect(result.storagePath).toBe("documents/content/d-1.pdf");

    const written = fsa.readFile("documents/content/d-1.pdf");
    expect(written).not.toBeNull();
    expect(Array.from(written!)).toEqual(Array.from(bytes));
  });
});
