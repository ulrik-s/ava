/**
 * Faktureringens "måste göras" (#1221) — predikat för när ett ärende väntar på
 * en faktureringsåtgärd. Ren logik, ingen I/O. De driver faktureringspanelens
 * åtgärdsrutor; Frister visar dem inte (#1735).
 */

import type { BillingRunRecipient, BillingRunStatus, BillingRunType, InvoiceStatus, PaymentMethod } from "../schemas/enums";
import type { BillingRunId } from "../schemas/ids";
import { accontoSplit } from "./acconto-vat";
import { isCoverageMethod } from "./billing-flow";
import { proposedAccontoOre } from "./billing-proposal";
import { canKrAction, krStateOf, type KostnadsrakningStatus } from "./kostnadsrakning-flow";
import { roundToKronor } from "./whole-kronor";

/** Det predikaten läser ur en billing-run (panelens rader och repo-raderna passar båda). */
export interface TodoRun {
  id?: BillingRunId | undefined;
  type: BillingRunType;
  status: BillingRunStatus;
  recipient: BillingRunRecipient;
  kostnadsrakningStatus?: KostnadsrakningStatus | null | undefined;
  beslutSlutgiltigt?: boolean | null | undefined;
  prutningOre?: number | null | undefined;
  /** Domstolens dömda belopp (brutto, öre) när beslutet är registrerat. */
  awardedOre?: number | null | undefined;
  /** Fakturan på körningen — livscykeln läser den för en äldre kostnadsräkning (#1859). */
  invoiceId?: string | null | undefined;
  invoice?: { status?: InvoiceStatus | null | undefined } | null | undefined;
}

/**
 * Kan faktura skapas på kostnadsräkningen? Beslutet är registrerat men fakturan
 * inte skapad. KR-kortets "Skapa faktura"-knapp läser detta.
 */
export function krCanCreateInvoice(r: TodoRun): boolean {
  return canKrAction(krStateOf(r), "SKAPA_FAKTURA");
}

/**
 * Nettot (exkl. moms, öre) på det aconto som dialogen Aconto till klient
 * föreslår: klientens andel av det upparbetade minus tidigare skickade aconton,
 * avrundat till hela kronor som fakturan. Med moms är det exakt dialogens förslag.
 */
export function unbilledClientShareNetOre(workValueOre: number, clientShareBips: number, priorAccontoSumOre: number): number {
  return accontoSplit(roundToKronor(proposedAccontoOre(workValueOre, clientShareBips, priorAccontoSumOre))).netOre;
}

export interface SjalvriskInput {
  method: PaymentMethod | null | undefined;
  /** Upparbetat värde exkl. moms (öre) — `billingRun.proposal`, som dialogen. */
  workValueOre: number;
  /** Summan av skickade aconton (brutto, öre) — `billingRun.proposal`. */
  priorAccontoSumOre: number;
  clientShareBips: number;
  thresholdOre: number;
  /** Finns aconto bland ärendets tillgängliga åtgärder (`availableActions`)? */
  accontoAllowed: boolean;
}

/**
 * Självrisk-aconto (#854, #1852): rättshjälp eller rättsskydd, aconto tillåtet i
 * fasen, och nettot på dialogens förslag har nått tröskeln. Räknas om från noll
 * efter varje skickat aconto.
 */
export function sjalvriskAccontoDue(s: SjalvriskInput): boolean {
  if (!isCoverageMethod(s.method) || !s.accontoAllowed) return false;
  return unbilledClientShareNetOre(s.workValueOre, s.clientShareBips, s.priorAccontoSumOre) >= s.thresholdOre;
}

/**
 * Försäkringsbolagets prutning (#905/#952): rättsskydd, slutfaktura till
 * försäkringen finns, ingen prutning registrerad — och fakturan är inte redan
 * betald fullt ut (då prutade bolaget inte, och frågan är besvarad).
 */
export function insurerPruningPending(method: PaymentMethod | null | undefined, runs: readonly TodoRun[]): boolean {
  if (method !== "RATTSSKYDD") return false;
  const payerFinal = runs.find((r) => r.type === "FINAL" && r.recipient === "FORSAKRING");
  if (!payerFinal || payerFinal.invoice?.status === "PAID") return false;
  return !runs.some((r) => r.recipient === "FORSAKRING" && r.prutningOre != null);
}
