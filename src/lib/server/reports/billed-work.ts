/**
 * Byggstenarna för "Fakturerat per advokat" (#90), utbrutna ur
 * rapportroutern (#2176). Delas av `billed`, `firmOverview` och `arSummary`:
 * fryst arbete per (faktura, advokat), advokatens andel per faktura och
 * fakturorna som indata till `billedPerLawyer`.
 *
 * Enheter: `minutes` i heltal minuter, `hourlyRate` i öre/timme och alla
 * belopp i öre.
 */
import type { BilledInvoiceInput, FrozenWorkInput } from "@/lib/shared/billed-per-lawyer";
import { timeEntryValueOre } from "@/lib/shared/billing/whole-kronor";
import { calendarDate } from "@/lib/shared/calendar-periods";
import type { InvoiceStatus } from "@/lib/shared/schemas/enums";
import { asId, type BillingRunId, type InvoiceId, type UserId } from "@/lib/shared/schemas/ids";
import { stockholmDay, stockholmPeriod } from "@/lib/shared/stockholm-time";

/** Demo-projektionen lagrar datum som ISO-strängar → coerca till Date. */
export function coerceDate(v: unknown): Date {
  return v instanceof Date ? v : new Date(v as string);
}

/** Det ur en tidspost som det frysta arbetet läser. */
export interface RawTimeEntry {
  userId: UserId; minutes: number; hourlyRate: number;
  invoiceId?: InvoiceId | null | undefined; frozenByBillingRunId?: BillingRunId | null | undefined;
}
interface RawInvoice { id: string; amount: number; status: InvoiceStatus; invoiceDate: unknown; updatedAt: unknown }

/** Körning → fakturan den gav (körningar utan faktura utelämnas). */
export function runToInvoiceMap(billingRuns: readonly { id: string; invoiceId?: string | null | undefined }[]): Map<string, string> {
  const runToInvoice = new Map<string, string>();
  for (const r of billingRuns) if (r.invoiceId) runToInvoice.set(r.id, r.invoiceId);
  return runToInvoice;
}

/** Karta frozen tidsposter → arbetsvärde per (faktura, advokat). En post knyts
 *  till sin faktura via direkt `invoiceId` (legacy) eller via BillingRun. */
export function buildFrozenWork(
  timeEntries: RawTimeEntry[],
  runToInvoice: Map<string, string>,
): FrozenWorkInput[] {
  const out: FrozenWorkInput[] = [];
  for (const te of timeEntries) {
    const invoiceId = te.invoiceId ?? (te.frozenByBillingRunId ? runToInvoice.get(te.frozenByBillingRunId) : undefined);
    if (!invoiceId) continue;
    out.push({
      invoiceId: asId<"InvoiceId">(invoiceId),
      userId: asId<"UserId">(te.userId),
      workOre: timeEntryValueOre(te.minutes, te.hourlyRate),
    });
  }
  return out;
}

/** invoiceId → advokatens andel (userWork/totalWork ∈ [0,1]) ur frysta tidsposter. */
export function lawyerShareRatios(frozenWork: FrozenWorkInput[], userId: UserId): Map<string, number> {
  const total = new Map<string, number>();
  const user = new Map<string, number>();
  for (const fw of frozenWork) {
    total.set(fw.invoiceId, (total.get(fw.invoiceId) ?? 0) + fw.workOre);
    if (fw.userId === userId) user.set(fw.invoiceId, (user.get(fw.invoiceId) ?? 0) + fw.workOre);
  }
  const ratio = new Map<string, number>();
  for (const [inv, t] of total) if (t > 0) ratio.set(inv, (user.get(inv) ?? 0) / t);
  return ratio;
}

/** invoiceId → senaste avskrivnings-tidpunkt ur WriteOff-posterna (ADR 0007). */
export function writtenOffDates(writeOffs: Array<{ invoiceId?: string; writtenOffAt?: unknown }>): Map<string, Date> {
  const m = new Map<string, Date>();
  for (const w of writeOffs) {
    if (!w.invoiceId) continue;
    const d = coerceDate(w.writtenOffAt);
    const cur = m.get(w.invoiceId);
    if (!cur || d.getTime() > cur.getTime()) m.set(w.invoiceId, d);
  }
  return m;
}

/** Fakturorna som indata till `billedPerLawyer`, med avskrivningstidpunkten. */
export function toInvoiceInputs(invoices: RawInvoice[], writtenOff: Map<string, Date>): BilledInvoiceInput[] {
  return invoices.map((i) => ({
    id: asId<"InvoiceId">(i.id),
    amountOre: i.amount,
    invoiceDate: coerceDate(i.invoiceDate),
    status: i.status,
    // Avskrivnings-tidpunkt från WriteOff-posten (ADR 0007); fallback till
    // updatedAt-heuristiken (#90) för ev. BAD_DEBT-faktura utan post.
    writtenOffAt: writtenOff.get(i.id) ?? (i.status === "BAD_DEBT" ? coerceDate(i.updatedAt) : null),
  }));
}

/** Föregående kalendermånad relativt periodstarten, på den svenska dagen (#1677): gränserna är
 *  svensk midnatt den första till sista millisekunden den sista dagen i månaden. */
export function previousCalendarMonth(periodStart: Date): { from: Date; to: Date } {
  const first = calendarDate(`${stockholmDay(periodStart).slice(0, 7)}-01`);
  const y = first.getUTCFullYear();
  const m = first.getUTCMonth();
  // Dag 0 i denna månad = sista dagen i föregående. UTC-midnatt → samma svenska dag.
  return stockholmPeriod(stockholmDay(new Date(Date.UTC(y, m - 1, 1))), stockholmDay(new Date(Date.UTC(y, m, 0))));
}
