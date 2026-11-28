"use client";

/**
 * `renderFakturaPdf` — fakturans PDF ur en mall (ADR 0042, #2251). Fakturans
 * enda format: dokumentet som arkiveras i ärendet, bilagan som mejlas och
 * demons fakturor ritas alla här, ur samma vy-modell (`buildFakturaView`), så
 * de kan aldrig visa olika belopp.
 *
 * Mallen är byråns fakturamall (#2255) tills vidare; fas 2 skickar in byråns
 * egen mall (Mallar-vyn) som `source`. Bilderna mallen når: `logo` (loggan i
 * brevhuvudet) och `seal` (sigillet i sidfoten).
 */

import type { FakturaView } from "@/lib/client/kostnadsrakning/faktura-template";
import type { DocumentTemplateSource } from "@/lib/shared/documents/template-source";
import { FAKTURA_BREV_TEMPLATE } from "@/lib/shared/documents/templates/faktura-brev";
import { renderDocumentPdf } from "./render-document";

/** Rendera fakturan till PDF med mallen `source` (byråns fakturamall om den utelämnas). */
export function renderFakturaPdf(view: FakturaView, source: DocumentTemplateSource = FAKTURA_BREV_TEMPLATE): Promise<Uint8Array> {
  return renderDocumentPdf({ source, context: view, images: { logo: view.logo, seal: view.footerSeal } });
}
