/**
 * Delade hjälpare för billingRun-routerns procedurgrupper (#1766, steg 1).
 *
 * Funktionerna används av flera procedurgrupper och är flyttade oförändrade ur
 * `billingRun.ts`. Mappen `routers/billingRun/` är routerns privata moduler
 * (dependency-cruiser: `billingRun-router-internals-private`).
 */
import { TRPCError } from "@trpc/server";
import type { AccontoWork } from "@/lib/shared/billing/acconto-view";
import { assertBillingTransition, type BillingActionType } from "@/lib/shared/billing/billing-flow";
import type { UnfrozenWork } from "@/lib/shared/billing/billing-work-value";
import type { SpecDeduction } from "@/lib/shared/billing/invoice-specification";
import { isKrWorkEntry } from "@/lib/shared/billing/kostnadsrakning";
import { applyKrAction, type KostnadsrakningAction, type KostnadsrakningState } from "@/lib/shared/billing/kostnadsrakning-flow";
import { ocrFromInvoiceNumber } from "@/lib/shared/ocr-reference";
import type { BillingRun, Expense, TimeEntry } from "@/lib/shared/schemas/billing";
import type { BillingRunRecipient } from "@/lib/shared/schemas/enums";
import {
  asId, type BillingRunId, type ExpenseId, type InvoiceId, type MatterId, type OrganizationId, type TimeEntryId,
} from "@/lib/shared/schemas/ids";
import { stockholmYear } from "@/lib/shared/stockholm-time";
import { newRowId, type QueuedCallScope } from "../../queued-call";
import type { Repositories } from "../../repositories/repositories";

/** Det ofrysta arbetet i ärendet. Utläggen har kvar datum och beskrivning, som
 *  acontofakturans specifikation visar (#1940). */
export async function fetchUnfrozenWork(repos: Repositories, matterId: MatterId): Promise<AccontoWork> {
  const te = await repos.timeEntries.listUnfrozenForMatter(matterId);
  const ex = await repos.expenses.listUnfrozenForMatter(matterId);
  return { timeEntries: te, expenses: ex.filter((e) => e.kind !== "PRUTNING") };
}

/** Det arbete en kostnadsräkning frös vid inskick (#806) — underlag för dom/
 *  slutreglering. PRUTNING-rader (skapas vid domen) länkas separat. */
export async function fetchWorkByRun(repos: Repositories, billingRunId: BillingRunId): Promise<UnfrozenWork> {
  const te = await repos.timeEntries.listByBillingRun(billingRunId);
  const ex = await repos.expenses.listByBillingRun(billingRunId);
  return { timeEntries: te.filter(isKrWorkEntry), expenses: ex.filter((e) => e.kind !== "PRUTNING") };
}

/** Summan av tidigare utställda ACCONTO-fakturors belopp för ett ärende (#397). */
export async function sumPriorAccontos(repos: Repositories, matterId: MatterId): Promise<number> {
  const runs = (await repos.billingRuns.listAccontoSent(matterId)) as ReadonlyArray<{ amountOre?: number }>;
  return runs.reduce((sum, r) => sum + (r.amountOre ?? 0), 0);
}

/**
 * Tidigare acontofakturor som avdrag, ur deras faktura-id (#1940): nummer,
 * datum och belopp, org-scopat. Ett id som saknas, eller en faktura i en annan
 * byrå, hoppas över. Delas av fakturaspecifikationen, slutregleringen och
 * acontofakturans nedbrytning.
 */
export async function accontoDeductionsByInvoiceIds(
  repos: Repositories,
  orgId: OrganizationId,
  invoiceIds: ReadonlyArray<InvoiceId | null | undefined>,
): Promise<SpecDeduction[]> {
  const out: SpecDeduction[] = [];
  for (const id of invoiceIds) {
    const inv = id ? await repos.invoices.getByIdInOrg(id, orgId) : null;
    if (inv) out.push({ invoiceNumber: inv.invoiceNumber ?? "—", date: inv.invoiceDate, amountOre: inv.amount });
  }
  return out;
}

/** De tidigare acontofakturorna som `sumPriorAccontos` summerar, som avdrag. */
export async function priorAccontoDeductions(repos: Repositories, orgId: OrganizationId, matterId: MatterId): Promise<SpecDeduction[]> {
  const runs = await repos.billingRuns.listAccontoSent(matterId);
  return accontoDeductionsByInvoiceIds(repos, orgId, runs.map((r) => r.invoiceId));
}

/**
 * Aconton som slutregleringen drar av (#856, #1892): de explicit valda plus alla
 * skickade i ärendet, utom de som en tidigare slutfaktura redan dragit av. Den
 * frågan avgör `invoices.listDeductibleAccontos` (avdragsraderna), så ett aconto
 * dras aldrig av två gånger.
 */
export async function undeductedAccontoRuns(
  repos: Repositories, matterId: MatterId, explicit: ReadonlyArray<BillingRunId>,
): Promise<BillingRun[]> {
  const sent = (await repos.billingRuns.listAccontoSent(matterId)).map((r) => r.id);
  const runs = await fetchDeductedAccontoRuns(repos, matterId, [...new Set([...explicit, ...sent])]);
  const invoiceIds = runs.flatMap((r) => (r.invoiceId ? [r.invoiceId] : []));
  const open = new Set((await repos.invoices.listDeductibleAccontos(matterId, invoiceIds)).map((i) => i.id));
  return runs.filter((r) => r.invoiceId != null && open.has(r.invoiceId));
}

/** Valda poster med hela raderna (#734, #1889). */
export interface SelectedWork { timeEntries: TimeEntry[]; expenses: Expense[] }

/**
 * De valda posterna (#734, #1889), validerade som ofakturerade och olåsta i
 * ärendet (#1862), med hela raderna. `null` när inget id anges: anroparen tar då
 * allt ofryst. PRUTNING-utlägg utesluts (de länkas separat i kostnadsräknings-
 * flödet). Delas av `createFinal` och `createKostnadsrakning`.
 */
export async function fetchSelectedWork(
  repos: Repositories,
  matterId: MatterId,
  ids: { timeEntryIds?: TimeEntryId[] | undefined; expenseIds?: ExpenseId[] | undefined },
): Promise<SelectedWork | null> {
  if (ids.timeEntryIds === undefined && ids.expenseIds === undefined) return null;
  const teIds = ids.timeEntryIds ?? [];
  const exIds = ids.expenseIds ?? [];
  const selTime = await repos.timeEntries.listUnbilled(matterId, teIds);
  const selExp = await repos.expenses.listUnbilled(matterId, exIds);
  if (selTime.length !== teIds.length || selExp.length !== exIds.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Någon vald post är redan fakturerad eller tillhör annat ärende." });
  }
  return { timeEntries: selTime, expenses: selExp.filter((e) => e.kind !== "PRUTNING") };
}

/** Frys valda poster (per post) eller, utan urval, hela ärendets ofrysta arbete. */
export async function freezeSelectedWork(
  repos: Repositories,
  a: { matterId: MatterId; selected: SelectedWork | null; runId: BillingRunId; now: Date },
): Promise<void> {
  const { matterId, selected, runId, now } = a;
  if (!selected) {
    await freezeWork(repos, matterId, runId, now);
    return;
  }
  await repos.timeEntries.freezeByIds(selected.timeEntries.map((t) => t.id), runId, now);
  await repos.expenses.freezeByIds(selected.expenses.map((e) => e.id), runId, now);
}

export async function freezeWork(repos: Repositories, matterId: MatterId, billingRunId: BillingRunId, now: Date): Promise<void> {
  await repos.timeEntries.freezeForMatter(matterId, billingRunId, now);
  await repos.expenses.freezeForMatter(matterId, billingRunId, now);
}

/**
 * Koppla de DEBITERBARA frysta posterna till FINAL-fakturan (invoice_id) +
 * registrera acconto-avdrag. Utan detta härleder slutfaktura-vyn `0.00` för
 * arvode/utlägg (den summerar bara fakture-länkade poster) trots korrekt
 * totalbelopp — frysning ensam räcker inte. Gör en billing-run-faktura
 * identisk (för vy/ledger) med en legacy-skapad (#728). `work` är de poster
 * som precis frystes; bara `billable` ingår i fakturabeloppet (jfr workValueOre).
 */
export async function linkFinalInvoice(
  repos: Repositories,
  invoiceId: InvoiceId,
  work: UnfrozenWork,
  deductedAccontoInvoiceIds: ReadonlyArray<InvoiceId>,
  scope: QueuedCallScope = {},
): Promise<void> {
  await repos.timeEntries.flagBilled(work.timeEntries.filter((t) => t.billable).map((t) => t.id), invoiceId);
  await repos.expenses.flagBilled(work.expenses.filter((e) => e.billable).map((e) => e.id), invoiceId);
  for (const accontoInvoiceId of deductedAccontoInvoiceIds) {
    // Id per avdraget aconto (#1276): samma i klientens körning och serverns.
    const id = asId<"AccontoDeductionId">(newRowId(scope, `accontoDeduction:${accontoInvoiceId}`));
    await repos.accontoDeductions.create({ id, finalInvoiceId: invoiceId, accontoInvoiceId });
  }
}

/**
 * Flödes-guard (#816 fas 3): säkerställer att ärendet finns OCH att `action` är
 * laglig i ärendets nuvarande fas enligt billing-flow-modellen (samma sanningskälla
 * som UI:t). Hård enforcement för ALLA betalningssätt — skyddar mot stale klienter
 * / direkt-API som tar ett otillåtet steg (t.ex. slutreglera ett PRIVAT-ärende
 * eller fakturera ett nekat rättsskydd).
 */
export async function assertFlowAction(repos: Repositories, orgId: OrganizationId, matterId: MatterId, action: BillingActionType): Promise<void> {
  const matter = await repos.matters.getByIdInOrg(matterId, orgId);
  if (!matter) throw new TRPCError({ code: "NOT_FOUND", message: "Ärendet finns inte." });
  const runs = await repos.billingRuns.listForOrg(orgId, matterId);
  try {
    assertBillingTransition({ paymentMethod: matter.paymentMethod, rattsskyddNekadAt: matter.rattsskyddNekadAt }, runs, action);
  } catch (e) {
    throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Otillåten faktureringsåtgärd." });
  }
}

/**
 * Tilldela fakturanummer + OCR (ADR 0012). Alla fakturor får `F-YYYY-NNNN`
 * (#889 — så domstolsfakturan syns i samma format som övriga i listan), MEN
 * domstolsfakturor får ingen OCR: domstolen betalar på beslut, inte via OCR.
 */
export async function invoiceNumbering(
  repos: Repositories,
  orgId: OrganizationId,
  recipient: BillingRunRecipient,
  invoiceDate: Date,
): Promise<{ invoiceNumber: string; ocrReference: string | null }> {
  // Serien är fakturadatumets år i svensk tid (ADR 0012, #1243, #1350).
  const invoiceNumber = await repos.invoices.nextInvoiceNumber(orgId, stockholmYear(invoiceDate));
  return { invoiceNumber, ocrReference: recipient === "DOMSTOL" ? null : ocrFromInvoiceNumber(invoiceNumber) };
}

/** Applicera en KR-övergång; översätt otillåten övergång till TRPCError. */
export function applyKrTransition(state: KostnadsrakningState, action: KostnadsrakningAction): KostnadsrakningState {
  try {
    return applyKrAction(state, action);
  } catch (e) {
    throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Otillåten kostnadsräknings-övergång." });
  }
}

/**
 * Validera + hämta de avdragna ACCONTO-körningarna. Säkerhet (#60): de måste
 * tillhöra SAMMA ärende och vara ACCONTO-körningar — annars kunde en FINAL dra
 * av främmande/fel-typade billing-runs och förvanska beloppet. Returnerar
 * körningarna (anroparen summerar `amountOre` + plockar deras `invoiceId`).
 */
export async function fetchDeductedAccontoRuns(
  repos: Repositories,
  matterId: MatterId,
  ids: ReadonlyArray<BillingRunId>,
): Promise<BillingRun[]> {
  if (ids.length === 0) return [];
  const runs = await repos.billingRuns.listAccontoByIds(matterId, [...ids]);
  if (runs.length !== ids.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Någon avdragspost tillhör inte detta ärende eller är ingen ACCONTO-körning.",
    });
  }
  return runs;
}
