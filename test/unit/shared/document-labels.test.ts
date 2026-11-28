/**
 * Test: dokumentets riktning och mottagare har etiketter och schema i
 * `enums.ts` (#1999), och `document.ts` exporterar samma scheman vidare.
 */

import { describe, it, expect } from "vitest-compat";
import * as documentSchemas from "@/lib/shared/schemas/document";
import {
  DOCUMENT_DIRECTION_LABELS, DOCUMENT_RECIPIENT_LABELS, documentDirectionSchema, documentRecipientSchema,
} from "@/lib/shared/schemas/enums";

describe("dokumentets riktning och mottagare (enums.ts)", () => {
  it("värdena och ordningen är oförändrade", () => {
    expect(documentDirectionSchema.options).toEqual(["INKOMMANDE", "UTGAENDE"]);
    expect(documentRecipientSchema.options).toEqual(["DOMSTOL", "MOTPART", "KLIENT", "FORSAKRING", "MYNDIGHET", "OVRIGT"]);
  });

  it("varje värde har en etikett", () => {
    for (const v of documentDirectionSchema.options) expect(DOCUMENT_DIRECTION_LABELS[v]).toBeTruthy();
    for (const v of documentRecipientSchema.options) expect(DOCUMENT_RECIPIENT_LABELS[v]).toBeTruthy();
  });

  it("försäkringsbolag och utgående heter som i resten av AVA", () => {
    expect(DOCUMENT_RECIPIENT_LABELS.FORSAKRING).toBe("Försäkringsbolag");
    expect(DOCUMENT_DIRECTION_LABELS.UTGAENDE).toBe("Utgående");
  });

  it("document.ts exporterar samma scheman som enums.ts", () => {
    expect(documentSchemas.documentDirectionSchema).toBe(documentDirectionSchema);
    expect(documentSchemas.documentRecipientSchema).toBe(documentRecipientSchema);
  });
});
