/**
 * Faktureringens "måste göras" (#1221) — EN uppsättning predikat för när ett
 * ärende väntar på en faktureringsåtgärd. Ren logik, ingen I/O.
 *
 * Samma predikat driver två ställen: faktureringspanelens åtgärdsrutor (med sina
 * knappar) och "Att bevaka"-signalen `billingAction` (startsidan, /watchlist och
 * ärendets panel). Då kan de aldrig säga emot varandra: rutan i panelen och
 * posten i Att bevaka försvinner av samma skäl, i samma ögonblick.
 */

import { settlementArvodeNet } from "./billing-work-value";
import { computeCoverageSplit } from "./coverage-billing";
import { availableKrActions, krStateOf, type KostnadsrakningStatus } from "./kostnadsrakning-flow";
import type { BillingRunRecipient, BillingRunStatus, BillingRunType, InvoiceStatus, PaymentMethod, TimeEntryKind } from "./schemas/enums";
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
  invoice?: { status?: InvoiceStatus | null | undefined } | null | undefined;
}

/** Inget betalningssätt valt — ingen fakturering kan göras innan det är bestämt. */
export function paymentMethodPending(method: PaymentMethod | null | undefined): boolean {
  return (method ?? "PENDING") === "PENDING";
}

/** Aktiv kostnadsräkning (#828): livscykeln är inte klar och den är inte ångrad (#1121). */
export function isActiveKr(r: TodoRun): boolean {
  return r.type === "KOSTNADSRAKNING" && r.status !== "VOIDED"
    && !!r.kostnadsrakningStatus && r.kostnadsrakningStatus !== "FAKTURERAD";
}

/**
 * Väntar kostnadsräkningen på att domstolens beslut registreras? `TINGSRATT` =
 * första beslutet, `HOVRATT` = efter överklagande. Null = inget beslut väntar.
 */
export function krAwaitingBeslut(runs: readonly TodoRun[]): "TINGSRATT" | "HOVRATT" | null {
  const kr = runs.find(isActiveKr);
  if (!kr) return null;
  const acts = availableKrActions(krStateOf(kr));
  if (acts.includes("REGISTRERA_HOVRATT_BESLUT")) return "HOVRATT";
  return acts.includes("REGISTRERA_BESLUT") ? "TINGSRATT" : null;
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

/** Skapad men inte skickad (#1138): fakturan har nummer men har inte gått ut. */
export function isUnsentInvoice(inv: { status: InvoiceStatus | string }): boolean {
  return inv.status === "DRAFT";
}

/** Tidsposten som självrisken räknas på. */
export interface SjalvriskEntry {
  minutes: number;
  hourlyRate: number;
  billable: boolean;
  date: Date | string;
  kind?: TimeEntryKind | null | undefined;
  frozenAt?: Date | string | null | undefined;
  frozenByBillingRunId?: BillingRunId | null | undefined;
}

/**
 * Klientens självrisk i ett rättshjälpsärende, på samma underlag som
 * slutregleringen (`billingRun.coverageSplit`): väntar en kostnadsräkning på dom
 * är det dess frysta poster, annars allt ofryst. Den låsta rådgivningstimmen är
 * fryst och ingår därför aldrig.
 */
export function rattshjalpSjalvriskOre(
  entries: readonly SjalvriskEntry[], runs: readonly TodoRun[], clientShareBips: number, now: Date,
): number {
  const pendingKr = runs.find((r) => r.type === "KOSTNADSRAKNING" && r.status === "PENDING_VERDICT");
  const work = pendingKr
    ? entries.filter((e) => e.frozenByBillingRunId === pendingKr.id)
    : entries.filter((e) => !e.frozenAt && !e.frozenByBillingRunId);
  const totalOre = settlementArvodeNet("RATTSHJALP", { timeEntries: work }, now);
  return computeCoverageSplit({ method: "RATTSHJALP", totalOre, clientShareBips }).clientOre;
}
