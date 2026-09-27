/**
 * Rådgivningstimmens låsta tidspost (#1205/#1207) — EN regel för när ett
 * rättshjälpsärende saknar den och vilken post som får markeras som den.
 *
 * Sedan #1205 skapar `invoice.createRadgivning` själv en låst 60-minuterspost
 * kopplad till rådgivningsfakturan. Ärenden vars rådgivningsfaktura skapades
 * före #1205 saknar posten; juristen kan då peka ut mötet i tidslistan
 * ("Markera som rådgivning"). Servern (`timeEntry.markAsRadgivning`) och UI:t
 * (åtgärden + varningen i fakturapanelen) läser samma predikat.
 */

import { isPerDayKind } from "./brottmalstaxa";
import { isRadgivningInvoiced } from "./rattshjalp";
import type { InvoiceType, PaymentMethod, TimeEntryKind } from "./schemas/enums";
import type { InvoiceId } from "./schemas/ids";
import { isInvoicedOutsideCoverage, isLockedEntry, type LockableEntry } from "./time-entry-lock";

/** Rådgivningsfakturans notering — oförändrad sedan #389, så den känner igen
 *  även fakturor från före #1205 (ACCONTO #851 eller STANDARD #853). */
export const RADGIVNING_INVOICE_NOTES = "Rådgivningstimme enligt rättshjälpstaxan (1 tim).";

/** Rådgivningstimmen är exakt 1 tim enligt rättshjälpstaxan. */
export const RADGIVNING_MINUTES = 60;

/** Det som krävs av en faktura för att känna igen rådgivningsfakturan. */
export interface RadgivningInvoiceCandidate {
  id: InvoiceId;
  notes?: string | null | undefined;
  invoiceType?: InvoiceType | null | undefined;
}

/** Är fakturan en rådgivningsfaktura (aldrig en kreditnota)? */
export function isRadgivningInvoice(i: RadgivningInvoiceCandidate): boolean {
  return i.notes === RADGIVNING_INVOICE_NOTES && i.invoiceType !== "CREDIT";
}

/** Ärendets rådgivningsfaktura (aldrig en kreditnota), eller null. */
export function findRadgivningInvoiceId(invoices: readonly RadgivningInvoiceCandidate[]): InvoiceId | null {
  return invoices.find(isRadgivningInvoice)?.id ?? null;
}

/**
 * Finns en post kopplad till rådgivningsfakturan? Varje (icke-raderad) post med
 * fakturans `invoiceId` räknas (#1235) — även ett ej debiterbart möte som också
 * frysts av kostnadsräkningens körning. Raderade poster filtreras redan av
 * `listByInvoice`.
 */
export function hasRadgivningEntry(invoiceEntries: readonly LockableEntry[]): boolean {
  return invoiceEntries.length > 0;
}

/** Ärendefälten predikatet läser. */
export interface RadgivningMatter {
  paymentMethod?: PaymentMethod | null | undefined;
  radgivningBetaldAt?: Date | string | null | undefined;
}

/**
 * Var står ärendet? `not-applicable` = inte rättshjälp eller ingen rådgivning
 * registrerad; `missing` = rådgivningsfakturan finns men ingen låst post;
 * `present` = posten finns (skapad av #1205 eller redan markerad).
 */
export type RadgivningEntryStatus =
  | { kind: "not-applicable" }
  | { kind: "no-invoice" }
  | { kind: "missing"; invoiceId: InvoiceId }
  | { kind: "present"; invoiceId: InvoiceId };

export function radgivningEntryStatus(
  matter: RadgivningMatter,
  invoiceId: InvoiceId | null,
  invoiceEntries: readonly LockableEntry[],
): RadgivningEntryStatus {
  if (!isRadgivningInvoiced(matter)) return { kind: "not-applicable" };
  if (invoiceId === null) return { kind: "no-invoice" };
  return hasRadgivningEntry(invoiceEntries) ? { kind: "present", invoiceId } : { kind: "missing", invoiceId };
}

/** Behöver ärendet en rådgivningspost? (varningen + åtgärdens synlighet) */
export function needsRadgivningEntry(status: RadgivningEntryStatus): status is { kind: "missing"; invoiceId: InvoiceId } {
  return status.kind === "missing";
}

/** Det som krävs av tidsposten för att avgöra om den får markeras. */
export interface MarkableEntry extends LockableEntry {
  billable: boolean;
  kind?: TimeEntryKind | null | undefined;
}

/**
 * Är posten redan låst på ett sätt som gör markeringen till en pengafråga?
 * Låst direkt mot en faktura är alltid stopp. Fryst av en körning är stopp för
 * debiterbar tid (den ingår i det yrkade beloppet) men inte för ej debiterbar
 * tid (#1235) — den yrkas inte, så kopplingen flyttar inga pengar.
 */
function isLockedForMark(entry: MarkableEntry): boolean {
  return isInvoicedOutsideCoverage(entry) || (entry.billable && isLockedEntry(entry));
}

/** Varför posten inte får markeras som rådgivning, eller null om den får det. */
export function entryMarkBlocker(entry: MarkableEntry): string | null {
  if (isLockedForMark(entry)) return "Tidsposten är redan låst och kan inte markeras som rådgivning.";
  if (isPerDayKind(entry.kind)) return "Advokatberedskap kan inte markeras som rådgivning.";
  return null;
}

/** Ärendets rådgivningsfaktura att låsa mot — eller skälet till att ärendet inte tar emot en markering. */
export type MarkTarget = { ok: true; invoiceId: InvoiceId } | { ok: false; reason: string };

export function markTarget(status: RadgivningEntryStatus): MarkTarget {
  switch (status.kind) {
    case "not-applicable": return { ok: false, reason: "Ärendet är inget rättshjälpsärende med registrerad rådgivningstimme." };
    case "no-invoice": return { ok: false, reason: "Ärendets rådgivningsfaktura hittades inte." };
    case "present": return { ok: false, reason: "Ärendet har redan en låst rådgivningspost." };
    case "missing": return { ok: true, invoiceId: status.invoiceId };
  }
}

/**
 * Minuter som låses mot rådgivningsfakturan resp. blir kvar som vanlig tid.
 * Rådgivningstimmen är exakt 1 tim — en längre post delas.
 */
export function splitRadgivningMinutes(minutes: number): { locked: number; rest: number } {
  const locked = Math.min(minutes, RADGIVNING_MINUTES);
  return { locked, rest: minutes - locked };
}
