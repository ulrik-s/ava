/**
 * Underlaget till "Att bevaka"-signalen `billingAction` (#1221), ur data som
 * watchlist-routern redan läst org-brett i EN omgång per entitetstyp:
 * ärenden, billing-runs, fakturor och debiterbara tidsposter — plus posterna
 * kopplade till rådgivningsfakturorna (debiterbara eller ej, #1235). Inga
 * frågor per ärende — startsidan laddas hela dagen.
 *
 * Predikaten själva bor i `@/lib/shared/billing-todo` och `radgivning-entry`,
 * samma som faktureringspanelen läser.
 */

import { rattshjalpSjalvriskOre, type SjalvriskEntry, type TodoRun } from "@/lib/shared/billing-todo";
import { findRadgivningInvoiceId, needsRadgivningEntry, radgivningEntryStatus, type RadgivningInvoiceCandidate } from "@/lib/shared/radgivning-entry";
import type { InvoiceStatus, PaymentMethod } from "@/lib/shared/schemas/enums";
import type { InvoiceId, MatterId } from "@/lib/shared/schemas/ids";
import type { LockableEntry } from "@/lib/shared/time-entry-lock";
import type { BillingActionInvoice, BillingActionMatter } from "@/lib/shared/watchlist";

/** Ärendefälten signalen läser. */
export interface ActionMatterRow {
  id: string;
  matterNumber: string;
  status?: string | null;
  paymentMethod?: PaymentMethod | null;
  clientShareBips?: number | null;
  radgivningBetaldAt?: Date | string | null;
}

export interface ActionRunRow extends TodoRun {
  matterId: MatterId;
}

export interface ActionInvoiceRow extends RadgivningInvoiceCandidate {
  matterId: MatterId;
  invoiceNumber?: string | null | undefined;
  status: InvoiceStatus | string;
  amount: number;
  /** Fakturadatum som svensk kalenderdag (routern normaliserar). */
  day: string | null;
}

export interface ActionEntryRow extends SjalvriskEntry, LockableEntry {
  matterId: MatterId;
  invoiceId?: InvoiceId | null | undefined;
}

export interface BillingActionSources {
  matters: readonly ActionMatterRow[];
  runs: readonly ActionRunRow[];
  invoices: readonly ActionInvoiceRow[];
  entries: readonly ActionEntryRow[];
  /** Poster kopplade till rådgivningsfakturorna — oavsett debiterbar (#1235). */
  radgivningEntries: readonly ActionEntryRow[];
  sjalvriskThresholdOre: number;
  now: Date;
}

function groupBy<T extends { matterId: string }>(rows: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const list = out.get(r.matterId) ?? [];
    list.push(r);
    out.set(r.matterId, list);
  }
  return out;
}

/** Saknas rådgivningsfakturans låsta post? Samma predikat som `timeEntry.radgivningStatus`. */
function radgivningMissing(m: ActionMatterRow, invoices: readonly ActionInvoiceRow[], entries: readonly ActionEntryRow[]): boolean {
  const invoiceId = findRadgivningInvoiceId(invoices);
  const invoiceEntries = invoiceId === null ? [] : entries.filter((e) => e.invoiceId === invoiceId);
  return needsRadgivningEntry(radgivningEntryStatus(m, invoiceId, invoiceEntries));
}

function toActionInvoice(inv: ActionInvoiceRow): BillingActionInvoice {
  return { id: String(inv.id), invoiceNumber: inv.invoiceNumber ?? null, status: inv.status, amountOre: inv.amount, day: inv.day };
}

/** Stängda/arkiverade ärenden väntar inte på något — de tas inte med. */
const isOpen = (m: ActionMatterRow): boolean => (m.status ?? "ACTIVE") === "ACTIVE";

/** Ärendenas faktureringsläge, redo för `billingActionItems`. */
export function billingActionMatters(src: BillingActionSources): BillingActionMatter[] {
  const runs = groupBy(src.runs);
  const invoices = groupBy(src.invoices);
  const entries = groupBy(src.entries);
  const radgivningEntries = groupBy(src.radgivningEntries);
  return src.matters.filter(isOpen).map((m) => {
    const mRuns = runs.get(m.id) ?? [];
    const mInvoices = invoices.get(m.id) ?? [];
    const mEntries = entries.get(m.id) ?? [];
    const rattshjalp = m.paymentMethod === "RATTSHJALP";
    return {
      id: m.id, matterNumber: m.matterNumber, paymentMethod: m.paymentMethod ?? null,
      runs: mRuns, invoices: mInvoices.map(toActionInvoice),
      radgivningEntryMissing: radgivningMissing(m, mInvoices, radgivningEntries.get(m.id) ?? []),
      sjalvriskClientOre: rattshjalp ? rattshjalpSjalvriskOre(mEntries, mRuns, m.clientShareBips ?? 0, src.now) : null,
      sjalvriskThresholdOre: src.sjalvriskThresholdOre,
    };
  });
}
