/**
 * Faktureringshändelser som tjänsteanteckningar (#1221) — ren text, ingen I/O.
 *
 * Faktureringspanelen visade förut informativa rutor ("✓ Fakturerad",
 * "Ärendet är slutreglerat", kostnadsräkningens status-berättelse). De sa vad
 * som HADE hänt, men bara så länge läget stod kvar — historiken försvann när
 * nästa steg togs. Nu skriver servern en tjänsteanteckning i samma transaktion
 * som händelsen, och ärendets Anteckningar blir faktureringens logg.
 *
 * Texterna är korta och sakliga: vad hände, vilket dokument, vilket belopp.
 * Beloppen är fakturornas egna (brutto för fakturor, netto där det sägs).
 */

import { formatKr } from "./format-kr";
import { INVOICE_STATUS_LABELS, INVOICE_TYPE_LABELS, PAYMENT_METHOD_LABELS, type InvoiceStatus, type InvoiceType, type PaymentMethod } from "./schemas/enums";
import { stockholmDay } from "./stockholm-time";

const TIME_FMT = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" });

/** Anteckningens datum + klockslag i byråns tidszon ("YYYY-MM-DD", "HH:mm"). */
export function noteTimestamp(at: Date): { date: string; time: string } {
  return { date: stockholmDay(at), time: TIME_FMT.format(at) };
}

/** Fakturanumret, eller "(utan nummer)" för en faktura som saknar ett. */
function nr(invoiceNumber: string | null | undefined): string {
  return invoiceNumber ?? "(utan nummer)";
}

export function radgivningInvoicedNote(invoiceNumber: string | null | undefined, grossOre: number): string {
  return `Rådgivningstimme fakturerad klienten — faktura ${nr(invoiceNumber)}, ${formatKr(grossOre)}`;
}

/** Faktura skapad. `what` beskriver fakturan när typen inte räcker (t.ex. "kostnadsräkning till domstol"). */
export function invoiceCreatedNote(invoiceNumber: string | null | undefined, type: InvoiceType, amountOre: number, what?: string): string {
  const label = what ?? INVOICE_TYPE_LABELS[type].toLowerCase();
  return `Faktura ${nr(invoiceNumber)} skapad (${label}, ${formatKr(amountOre)})`;
}

/**
 * Manuell kreditering (`invoice.createCredit`). Beloppet är kreditfakturans eget
 * (negativt). Slutregleringens kreditfaktura står i `settledNote` i stället.
 */
export function creditCreatedNote(creditNumber: string | null | undefined, amountOre: number, originalNumber: string | null | undefined): string {
  return `Kreditfaktura ${nr(creditNumber)} skapad (${formatKr(amountOre)}) — krediterar faktura ${nr(originalNumber)}`;
}

export function kostnadsrakningSubmittedNote(reference: string | null | undefined, court: string | null | undefined, grossOre: number): string {
  const ref = reference ? ` ${reference}` : "";
  // Skapas först, skickas i ett senare steg — anteckningen säger därför "skapad".
  return `Kostnadsräkning${ref} till ${court ?? "domstolen"} skapad — ${formatKr(grossOre)}`;
}

export interface BeslutNoteInput {
  /** Hovrättens (slutgiltiga) beslut i st.f. tingsrättens första. */
  hovratt: boolean;
  awardedOre: number;
  claimedOre: number;
  /** Registrerad prutning (negativ eller null). */
  prutningOre: number | null | undefined;
}

export function beslutRegisteredNote(b: BeslutNoteInput): string {
  const vem = b.hovratt ? "Hovrättens beslut" : "Beslut";
  const prutning = b.prutningOre ? `, prutning ${formatKr(Math.abs(b.prutningOre))}` : "";
  return `${vem} registrerat: dömt belopp ${formatKr(b.awardedOre)} (yrkat ${formatKr(b.claimedOre)})${prutning}`;
}

export function krAppealedNote(reference: string | null | undefined): string {
  const ref = reference ? ` ${reference}` : "";
  return `Beslutet om kostnadsräkning${ref} överklagat till hovrätten`;
}

/**
 * Vad som hände med kostnadsräkningens dokument när den ångrades (#1230):
 * borttaget (filnamnen), kvar för att det inte gick att identifiera entydigt,
 * eller inget dokument alls.
 */
export type KrVoidedDocOutcome =
  | { kind: "removed"; fileNames: readonly string[] }
  | { kind: "kept" }
  | { kind: "none" };

function voidedDocSuffix(doc: KrVoidedDocOutcome): string {
  if (doc.kind === "kept") return ", dokumentet kunde inte identifieras och ligger kvar";
  if (doc.kind === "none") return "";
  const names = doc.fileNames.join(", ");
  return doc.fileNames.length === 1 ? `, dokumentet ${names} borttaget` : `, dokumenten ${names} borttagna`;
}

export function krVoidedNote(reference: string | null | undefined, doc: KrVoidedDocOutcome = { kind: "none" }): string {
  const ref = reference ? ` ${reference}` : "";
  return `Kostnadsräkning${ref} ångrad — tidposter och utlägg upplåsta${voidedDocSuffix(doc)}`;
}

export interface SettledNoteInput {
  client: { invoiceNumber: string | null | undefined; amountOre: number; credit: boolean };
  payer: { invoiceNumber: string | null | undefined; amountOre: number; recipientLabel: string };
}

export function settledNote(s: SettledNoteInput): string {
  const clientKind = s.client.credit ? "kreditfaktura" : "faktura";
  return `Ärendet slutreglerat — ${clientKind} ${nr(s.client.invoiceNumber)} till klienten (${formatKr(s.client.amountOre)}), `
    + `faktura ${nr(s.payer.invoiceNumber)} till ${s.payer.recipientLabel.toLowerCase()} (${formatKr(s.payer.amountOre)})`;
}

export function insurerPruningNote(prunedNetOre: number, clientInvoiceNumber: string | null | undefined): string {
  return `Försäkringsbolagets prutning registrerad: ${formatKr(prunedNetOre)} exkl moms flyttat till klientens faktura ${nr(clientInvoiceNumber)}`;
}

export function invoiceSentNote(invoiceNumber: string | null | undefined, recipient: string): string {
  return `Faktura ${nr(invoiceNumber)} skickad till ${recipient}`;
}

export function invoiceQueuedNote(invoiceNumber: string | null | undefined, recipient: string): string {
  return `Faktura ${nr(invoiceNumber)} köad för utskick till ${recipient}`;
}

/** Manuell statusändring (`invoice.setStatus`): "markerad som skickad" etc. */
export function invoiceStatusNote(invoiceNumber: string | null | undefined, status: InvoiceStatus): string {
  return `Faktura ${nr(invoiceNumber)} markerad som ${INVOICE_STATUS_LABELS[status].toLowerCase()}`;
}

export function paymentMethodNote(method: PaymentMethod): string {
  return `Betalningssätt: ${PAYMENT_METHOD_LABELS[method]}`;
}

export function rattsskyddNekadNote(day: string): string {
  return `Rättsskydd nekat (${day})`;
}
