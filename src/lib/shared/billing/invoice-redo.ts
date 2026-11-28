/**
 * "Fel på fakturan?" (#2260) — EN regel för hur en felaktig faktura görs om.
 * Delas av servern (makulera / kreditera och gör om) och fakturasidans dialog,
 * så att dialogen aldrig erbjuder något som servern sedan avvisar.
 *
 * Svensk praxis (mervärdesskattelagen 2023:200, 17 kap. 22–23 §§, och
 * bokföringslagen):
 *   - Ett utkast som inte har skickats eller bokförts **makuleras**: fakturan
 *     finns kvar som annullerad med sitt nummer, som aldrig återanvänds.
 *   - En utställd faktura ändras bara genom en **kreditnota** som hänvisar till
 *     originalets nummer; därefter skapas en ny, rätt faktura. En skickad
 *     faktura annulleras aldrig utan kreditnota.
 *
 * Ren logik, inga I/O.
 */

import type { InvoicePurpose, InvoiceStatus, InvoiceType } from "../schemas/enums";

/** Fakturans läge, så som regeln behöver det. */
export interface RedoFacts {
  status: InvoiceStatus;
  invoiceType: InvoiceType;
  purpose?: InvoicePurpose | null | undefined;
  /** Slutregleringens fakturor bär sin persisterade vy (`settlementBreakdown`). */
  hasSettlementBreakdown: boolean;
  /** Verifikatets referens (`ledgerRefOf`); `null` = obokförd. */
  ledgerRef: string | null;
  /** Har fakturan redan en kreditnota? */
  hasCreditNote: boolean;
  /** Registrerade inbetalningar (öre). */
  paidOre: number;
  /** Avskrivet som kundförlust (öre). */
  writtenOffOre: number;
  /** Nummer på levande (ej annullerade) slutfakturor som drar av fakturan — ett aconto. */
  liveDeductingFinals: readonly string[];
}

/** Vägen för en felaktig faktura: makulera, kreditera och gör om, eller ingen (med skäl). */
export type RedoOption =
  | { kind: "void" }
  | { kind: "credit" }
  | { kind: "blocked"; reason: string };

/** Varför en utställd faktura inte kan annulleras rakt av (`invoice.setStatus`). */
export const ISSUED_CANCEL_REASON =
  "En skickad faktura annulleras inte utan kreditnota (mervärdesskattelagen 17 kap. 22–23 §§). " +
  "Kreditera och gör om den i stället.";

/** Skälet när en betald eller delbetald faktura inte kan göras om här. */
export const PAID_REDO_REASON =
  "Fakturan har inbetalningar. En full kreditering skulle ge klienten ett tillgodohavande, " +
  "och det kan reskontran ännu inte visa (betalt + krediterat får inte överstiga fakturabeloppet, ADR 0007). " +
  "Kontakta byråns ekonomiansvariga för återbetalning eller kvittning.";

/** Skälet när fakturan har skrivits av som kundförlust. */
export const WRITTEN_OFF_REDO_REASON =
  "Fakturan är helt eller delvis avskriven som kundförlust och kan inte göras om här.";

/** Fakturor som redan är avslutade som felaktiga, eller som själva rättar en annan. */
function closedBlocker(f: RedoFacts): string | null {
  if (f.invoiceType === "CREDIT") return "En kreditfaktura kan inte göras om. Den rättar redan en annan faktura.";
  if (f.status === "CANCELLED" || f.hasCreditNote) return "Fakturan är redan annullerad eller krediterad.";
  return null;
}

/** Fakturor som skapats av ett flöde som inte görs om här. */
function flowBlocker(f: RedoFacts): string | null {
  if (f.purpose === "RADGIVNING") {
    return "Rådgivningstimmens faktura hör ihop med mötets låsta tidspost och görs inte om här.";
  }
  if (f.invoiceType === "FINAL" && f.hasSettlementBreakdown) {
    return "Slutregleringens fakturor (betalare och klient) hör ihop och görs inte om här.";
  }
  const final = f.liveDeductingFinals[0];
  return final === undefined ? null : `Acontot är avräknat på slutfaktura ${final}. Gör om slutfakturan först.`;
}

/** Fakturor med betalningar eller avskrivningar: reskontran kan inte visa en kreditering. */
function ledgerBlocker(f: RedoFacts): string | null {
  if (f.status === "BAD_DEBT" || f.writtenOffOre > 0) return WRITTEN_OFF_REDO_REASON;
  if (f.status === "PAID" || f.paidOre > 0) return PAID_REDO_REASON;
  return null;
}

/**
 * Hur fakturan görs om: ett obokfört utkast makuleras, en utställd (eller
 * bokförd) faktura krediteras och görs om. Annars ingen väg, med skälet.
 */
export function redoOption(f: RedoFacts): RedoOption {
  const reason = closedBlocker(f) ?? flowBlocker(f) ?? ledgerBlocker(f);
  if (reason !== null) return { kind: "blocked", reason };
  return f.status === "DRAFT" && f.ledgerRef === null ? { kind: "void" } : { kind: "credit" };
}

/** Det en faktura behöver bära för att regeln ska kunna avgöras (servern och sidan). */
export interface RedoInvoice {
  status: InvoiceStatus;
  invoiceType: InvoiceType;
  purpose?: InvoicePurpose | null | undefined;
  settlementBreakdown?: unknown;
  creditNote?: unknown;
  deductedOnFinals?: ReadonlyArray<{ finalInvoice: { status: InvoiceStatus; invoiceNumber?: string | null | undefined } | null }> | undefined;
}

/** Numren på de levande slutfakturor som drar av fakturan. */
function liveFinals(inv: RedoInvoice): string[] {
  return (inv.deductedOnFinals ?? [])
    .flatMap((d) => (d.finalInvoice && d.finalInvoice.status !== "CANCELLED" ? [d.finalInvoice.invoiceNumber ?? "(utan nummer)"] : []));
}

/** Regelns fakta ur fakturan, dess verifikat och dess avräkning. */
export function redoFactsOf(
  inv: RedoInvoice,
  ledger: { ledgerRef: string | null; paidOre: number; writtenOffOre: number },
): RedoFacts {
  return {
    status: inv.status, invoiceType: inv.invoiceType, purpose: inv.purpose,
    hasSettlementBreakdown: inv.settlementBreakdown != null,
    hasCreditNote: inv.creditNote != null,
    liveDeductingFinals: liveFinals(inv),
    ...ledger,
  };
}
