/**
 * Vilka dokument som kan flyttas till ett annat ärende (#2045). En regel för
 * servern (`document.moveToMatter`) och för menyraden och markeringen i
 * klienten (#2046), så att de inte kan glida isär.
 */

/** Fälten regeln läser: fakturans och kostnadsräkningens egna dokument. */
export interface MovableDocumentFields {
  invoiceId?: string | null | undefined;
  billingRunId?: string | null | undefined;
}

/** Varför fakturans och kostnadsräkningens egna dokument inte flyttas. */
export const OWNED_DOCUMENT_MOVE_BLOCKED = "Fakturans och kostnadsräkningens egna dokument kan inte flyttas.";

/** `null` när dokumentet kan flyttas, annars varför det inte kan det. */
export function documentMoveBlock(doc: MovableDocumentFields): string | null {
  return doc.invoiceId || doc.billingRunId ? OWNED_DOCUMENT_MOVE_BLOCKED : null;
}
