/**
 * `LedgerConnector` — pluggbar bokförings-/faktura-port (#234, ADR 0011).
 *
 * Faktura-domänen i AVA är SYSTEMOBEROENDE: den bygger semantiska verifikat
 * mot roller ([[semantic-voucher]]), äger fakturanummer/PDF/domänlogik och
 * vet inget om Fortnox, Visma, e-conomic eller SIE. Nedströms-bokföring och
 * -export sker via DENNA port. Varje externt system blir EN connector som
 * implementerar porten (Fortnox = den första, #82).
 *
 * Dep-cruiser (`invoice-domain-not-import-connector`) tvingar att
 * faktura-domänen (`src/lib/shared` + billing-routrar) får importera porten
 * men ALDRIG en connector (`integrations/<system>/`) — så fakturamodulen
 * bevisligen är fristående.
 *
 * All inbound extern data (betalningar) parsas strikt med zod vid
 * connector-gränsen per [[feedback-zod-strict-parsing]]; utbound DTO:er
 * (verifikat/faktura) byggs internt och är rena TS-interfaces.
 */

import { z } from "zod";
import type { SemanticVoucher } from "@/lib/shared/accounting/semantic-voucher";

export type { SemanticVoucher } from "@/lib/shared/accounting/semantic-voucher";

// ─── Capabilities ─────────────────────────────────────────────────────────

/**
 * Vad en connector KAN göra. Gat:ar både UI och vilka port-metoder som finns
 * — en `true`-flagga MÅSTE motsvaras av en implementerad metod (invariant
 * verifierad av `assertConnectorMatchesCapabilities`).
 */
export interface LedgerCapabilities {
  /** Tar emot semantiska verifikat (bokföring nedströms via Voucher-API e.d.). */
  pushVoucher: boolean;
  /** Skapar faktura i ledger-systemet (egen nummerserie — samexistens-läget). */
  pushInvoice: boolean;
  /** Levererar inkomna kundbetalningar för avprickning (bankfil/camt/BGI). */
  pullPayments: boolean;
  /** Exporterar SIE-fil. */
  exportSie: boolean;
}

// ─── Utbound DTO:er (byggs internt) ─────────────────────────────────────────

/** En bilaga att arkivera med verifikatet (t.ex. faktura-PDF, #785). */
export interface LedgerAttachment {
  fileName: string;
  bytes: Uint8Array;
  /** MIME-typ; default application/pdf hos connectorn. */
  contentType?: string;
}

/** Kontext för en verifikat-push (idempotens-nyckel + spårning). */
export interface LedgerPushContext {
  /** Idempotens-nyckel (t.ex. billingRunId) — connectorn får ej dubbel-bokföra. */
  idempotencyKey: string;
  /** Bilaga att koppla till verifikatet (faktura-PDF) om connectorn stöder det (#785). */
  attachment?: LedgerAttachment;
}

/** Resultat av en verifikat-push — det vi behöver för idempotens/spårning. */
export interface PushVoucherResult {
  /** Externt verifikat-id (t.ex. Fortnox VoucherSeries+VoucherNumber). */
  externalId: string;
}

/** Domän-faktura för `pushInvoice` (samexistens: faktura skapas i ledger-systemet). */
export interface LedgerInvoice {
  /** AVA:s fakturanummer (källan till sanning). */
  invoiceNumber: string;
  /** Bokföringsdatum. */
  invoiceDate: Date | string;
  /** Förfallodatum (om satt). */
  dueDate?: Date | string;
  /** Brutto i öre (negativt = kreditfaktura). */
  amount: number;
  /** Moms-sats i basis points (0/600/1200/2500). */
  vatRate: number;
  /** Kundens namn (för matchning/uppslag i ledger-systemet). */
  customerName: string;
}

/** Resultat av en faktura-push. */
export interface PushInvoiceResult {
  /** Externt faktura-id i ledger-systemet. */
  externalId: string;
}

// ─── Inbound DTO (parsas vid connector-gränsen) ─────────────────────────────

/**
 * En inkommen kundbetalning (för avprickning mot AVA-faktura). Vendor-neutral:
 * samma form oavsett källa (camt.053/054, BGMAX, Fortnox invoicepayments).
 * Connectorn parsar leverantörens format till denna DTO.
 */
export const ledgerPaymentSchema = z.object({
  /** Connector-/källspecifikt id (idempotens vid upprepad pull). */
  externalId: z.string().min(1),
  /** Inbetalt belopp i öre (positivt). */
  amount: z.number().int().positive(),
  /** Bokförings-/valutadatum `YYYY-MM-DD`. Valfritt — alla källor anger inte
   *  datum (t.ex. camt utan ValDt); avprickningen nyckar på referens, inte datum. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** OCR-/betalningsreferens om angiven (mod-10) — primär matchningsnyckel. */
  ocrReference: z.string().min(1).optional(),
  /** Betalarens namn om angivet (heuristik-fallback). */
  payerName: z.string().min(1).optional(),
});
export type LedgerPayment = z.infer<typeof ledgerPaymentSchema>;

/** Fråga för `pullPayments` — hämta betalningar från och med ett datum. */
export interface PullPaymentsQuery {
  /** Hämta betalningar bokförda från och med detta datum (`YYYY-MM-DD`). */
  since: string;
}

/** Datumintervall för SIE-export (`YYYY-MM-DD`). */
export interface SieExportRange {
  from: string;
  to: string;
}

// ─── Porten ─────────────────────────────────────────────────────────────────

/**
 * En pluggbar bokförings-/faktura-connector. Frivilliga metoder motsvaras 1:1
 * av `capabilities()`-flaggorna (se invarianten ovan). Server-runtime:ns
 * PeerAct (#80/#82) driver synken mot DENNA port, aldrig mot en konkret
 * leverantör.
 */
export interface LedgerConnector {
  /** Stabil connector-identitet, t.ex. `"fortnox"`. */
  readonly name: string;
  /** Vad connectorn kan i den aktuella konfigurationen. */
  capabilities(): LedgerCapabilities;
  /** Bokför ett semantiskt verifikat. Finns omm `capabilities().pushVoucher`. */
  pushVoucher?(voucher: SemanticVoucher, ctx: LedgerPushContext): Promise<PushVoucherResult>;
  /** Skapar en faktura i ledger-systemet. Finns omm `capabilities().pushInvoice`. */
  pushInvoice?(invoice: LedgerInvoice): Promise<PushInvoiceResult>;
  /** Hämtar inkomna betalningar. Finns omm `capabilities().pullPayments`. */
  pullPayments?(query: PullPaymentsQuery): Promise<LedgerPayment[]>;
  /** Exporterar SIE-fil. Finns omm `capabilities().exportSie`. */
  exportSie?(range: SieExportRange): Promise<string>;
}
