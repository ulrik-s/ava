/** `documentMoveBlock` (#2045): fakturans och kostnadsräkningens egna dokument flyttas inte. */

import { describe, expect, it } from "vitest-compat";
import { documentMoveBlock, OWNED_DOCUMENT_MOVE_BLOCKED } from "@/lib/shared/document-move";

describe("documentMoveBlock", () => {
  it("ett vanligt dokument kan flyttas", () => {
    expect(documentMoveBlock({})).toBeNull();
    expect(documentMoveBlock({ invoiceId: null, billingRunId: null })).toBeNull();
  });

  it("fakturans eller kostnadsräkningens dokument kan inte flyttas", () => {
    expect(documentMoveBlock({ invoiceId: "i1" })).toBe(OWNED_DOCUMENT_MOVE_BLOCKED);
    expect(documentMoveBlock({ billingRunId: "b1" })).toBe(OWNED_DOCUMENT_MOVE_BLOCKED);
    expect(OWNED_DOCUMENT_MOVE_BLOCKED).toBe("Fakturans och kostnadsräkningens egna dokument kan inte flyttas.");
  });
});
