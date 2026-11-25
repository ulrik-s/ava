/**
 * Bilagan i Fortnox-E2E:n (#1886). E2E:n bokför en testfaktura och ska då
 * också pröva att faktura-PDF:en laddas upp till verifikatinkorgen och kopplas
 * till verifikatet, med räkenskapsåret, precis som i appen (#785).
 *
 * PDF:en byggs i minnet: en tom sida med korrekt xref-tabell, så att Fortnox
 * tar emot den som en riktig PDF. Inget läses från disk.
 */

import type { BookingOutcome } from "@/lib/server/integrations/ledger/book-invoices";
import type { LedgerAttachment } from "@/lib/server/integrations/ledger/port";

const PDF_OBJECTS = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >>",
];

/** En minimal, giltig PDF med en tom sida. Offseten i xref är byte-exakta. */
export function minimalPdf(): Uint8Array {
  let body = "%PDF-1.4\n";
  const offsets = PDF_OBJECTS.map((obj, i) => {
    const at = body.length;
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
    return at;
  });
  const xrefAt = body.length;
  const entries = offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  body += `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n${entries}`;
  body += `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

/** Testfakturans bilaga, namngiven som fakturan så att den går att känna igen. */
export function e2eAttachment(invoiceNumber: string): LedgerAttachment {
  return { fileName: `${invoiceNumber}.pdf`, bytes: minimalPdf(), contentType: "application/pdf" };
}

/** Fäller körningen om bilagan inte kopplades till verifikatet. */
export function assertAttached(outcome: Pick<BookingOutcome, "attachmentError">): void {
  if (outcome.attachmentError) {
    throw new Error(`Bilagan kopplades inte till verifikatet: ${outcome.attachmentError}`);
  }
}
