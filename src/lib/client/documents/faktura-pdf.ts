"use client";

/**
 * `renderFakturaPdf` — fakturans PDF ur en mall (ADR 0042, #2251). Fakturans
 * enda format: dokumentet som arkiveras i ärendet, bilagan som mejlas och
 * demons fakturor ritas alla här, ur samma vy-modell (`buildFakturaView`), så
 * de kan aldrig visa olika belopp.
 *
 * Mallen är standardmallen tills vidare; fas 2 skickar in byråns egen mall
 * (Mallar-vyn) som `source`.
 */

import type { FakturaView } from "@/lib/client/kostnadsrakning/faktura-template";
import type { DocumentTemplateSource } from "@/lib/shared/documents/template-source";
import { STANDARD_FAKTURA_TEMPLATE } from "@/lib/shared/documents/templates/faktura";
import { renderDocumentPdf } from "./render-document";

/** Rendera fakturan till PDF med mallen `source` (standardmallen om den utelämnas). */
export function renderFakturaPdf(view: FakturaView, source: DocumentTemplateSource = STANDARD_FAKTURA_TEMPLATE): Promise<Uint8Array> {
  return renderDocumentPdf({ source, context: view, images: { logo: view.logo } });
}
