/**
 * Faktureringens "måste göras" (#1221) — predikat för när ett ärende väntar på
 * en faktureringsåtgärd. Ren logik, ingen I/O. De driver faktureringspanelens
 * åtgärdsrutor; Frister visar dem inte (#1735).
 */

import { canKrAction, krStateOf, type KostnadsrakningStatus } from "./kostnadsrakning-flow";
import type { BillingRunRecipient, BillingRunStatus, BillingRunType, InvoiceStatus, PaymentMethod } from "./schemas/enums";
import type { BillingRunId } from "./schemas/ids";

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
  invoice?: { status?: InvoiceStatus | null | undefined } | null | undefined;
}

/** Aktiv kostnadsräkning (#828): livscykeln är inte klar och den är inte ångrad (#1121). */
export function isActiveKr(r: TodoRun): boolean {
  return r.type === "KOSTNADSRAKNING" && r.status !== "VOIDED"
    && !!r.kostnadsrakningStatus && r.kostnadsrakningStatus !== "FAKTURERAD";
}

/**
 * Kan faktura skapas på kostnadsräkningen? Beslutet är registrerat men fakturan
 * inte skapad. KR-kortets "Skapa faktura"-knapp läser detta.
 */
export function krCanCreateInvoice(r: TodoRun): boolean {
  return canKrAction(krStateOf(r), "SKAPA_FAKTURA");
}

/** Har klienten redan fått ett självrisk-aconto? */
export function hasSjalvriskAconto(runs: readonly TodoRun[]): boolean {
  return runs.some((r) => r.type === "ACCONTO" && r.recipient === "KLIENT");
}

export interface SjalvriskInput {
  method: PaymentMethod | null | undefined;
  /** Klientens ackumulerade självrisk (netto, öre). */
  clientOre: number;
  thresholdOre: number;
  runs: readonly TodoRun[];
}

/** Självrisk-aconto (#854): rättshjälp, självrisken når tröskeln, inget aconto skickat. */
export function sjalvriskAccontoDue(s: SjalvriskInput): boolean {
  return s.method === "RATTSHJALP" && !hasSjalvriskAconto(s.runs) && s.clientOre >= s.thresholdOre;
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
