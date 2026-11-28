/**
 * "Fel på fakturan?" (#2260) — serversidan av regeln i
 * `@/lib/shared/billing/invoice-redo`: makulera ett obokfört utkast, eller
 * kreditera och göra om en utställd faktura. Båda vägarna släpper fakturans
 * poster i samma transaktion (`releaseInvoicePosts`), så att tidsposterna och
 * utläggen kommer tillbaka under Fakturera och kan faktureras igen.
 *
 * Fakturan raderas aldrig och numret återanvänds aldrig: den makulerade finns
 * kvar som CANCELLED, den krediterade får en kreditnota som hänvisar till den.
 */

import { TRPCError } from "@trpc/server";
import { creditForRedoNote, invoiceVoidedNote } from "@/lib/shared/billing/billing-notes";
import { redoFactsOf, redoOption, type RedoOption } from "@/lib/shared/billing/invoice-redo";
import { assertInvoiceTransition } from "@/lib/shared/billing/invoice-state-machine";
import { ledgerRefOf } from "@/lib/shared/ledger-ref";
import type { BillingRun, Invoice } from "@/lib/shared/schemas/billing";
import type { InvoiceId, OrganizationId } from "@/lib/shared/schemas/ids";
import type { Repositories } from "../repositories/repositories";
import { creditInvoice, type CreditInput, type CreditResult } from "./credit-invoice";
import { gatherInvoiceLedger } from "./invoice-ledger";
import { logMatterNote, type NoteCtx } from "./matter-note";

/** Det tjänsten behöver ur anropet: byrån, användaren (anteckningen) och det köade anropet. */
export type RedoCtx = NoteCtx & { orgId: OrganizationId };

/** Körningar som skapade fakturan och släpps med den: acontots och slutfakturans egna. */
function isReleasableRun(run: BillingRun): boolean {
  return (run.type === "ACCONTO" || run.type === "FINAL") && run.status !== "VOIDED";
}

/**
 * Släpp allt fakturan låste (#2260), inne i anroparens transaktion:
 *   - körningen som skapade fakturan annulleras (VOIDED). Ärendets fas räknas
 *     då om (en slutfaktura till försäkringen slutreglerar inte längre), ett
 *     aconto räknas inte längre som tidigare aconto, och slutfakturans
 *     avdragna aconton (`deductedBillingRunIds`) erbjuds igen,
 *   - tidsposter och utlägg: kopplingen till fakturan (`invoiceId`) och
 *     frysningen som körningen satte (`frozenAt`, `frozenByBillingRunId`).
 */
export async function releaseInvoicePosts(repos: Repositories, invoiceId: InvoiceId): Promise<void> {
  const runs = (await repos.billingRuns.listByInvoice(invoiceId)).filter(isReleasableRun);
  for (const run of runs) await repos.billingRuns.update(run.id, { status: "VOIDED" });
  const release = { invoiceId, billingRunIds: runs.map((r) => r.id) };
  await repos.timeEntries.releaseInvoice(release);
  await repos.expenses.releaseInvoice(release);
}

/**
 * Regelns svar för fakturan, med serverns egna avräkning och verifikat. En
 * faktura som en kostnadsräkning pekar på (domstolens beslut) görs inte om här:
 * beslutet och kostnadsräkningen står fast.
 */
async function redoOptionFor(repos: Repositories, orgId: OrganizationId, invoiceId: InvoiceId): Promise<{ inv: Invoice; option: RedoOption }> {
  const inv = await repos.invoices.getByIdFull(invoiceId, orgId);
  if (!inv) throw new TRPCError({ code: "NOT_FOUND" });
  const runs = await repos.billingRuns.listByInvoice(inv.id);
  if (runs.some((r) => r.type === "KOSTNADSRAKNING")) {
    return { inv, option: { kind: "blocked", reason: "Fakturan bygger på domstolens beslut om en kostnadsräkning och görs inte om här." } };
  }
  const { paid, writtenOff } = await gatherInvoiceLedger(repos, orgId, inv);
  return { inv, option: redoOption(redoFactsOf(inv, { ledgerRef: ledgerRefOf(inv), paidOre: paid, writtenOffOre: writtenOff })) };
}

/** Kasta regelns skäl, eller skälet att fakturan ska gå den andra vägen. */
function assertOption(option: RedoOption, wanted: "void" | "credit"): void {
  if (option.kind === wanted) return;
  const message = option.kind === "blocked" ? option.reason
    : wanted === "void"
      ? "Fakturan är skickad eller bokförd och kan inte makuleras. Den krediteras och görs om."
      : "Fakturan är ett obokfört utkast. Den makuleras i stället för att krediteras.";
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

/**
 * Makulera ett obokfört utkast (#2260): status CANCELLED, numret kvar, posterna
 * och körningen släpps och ärendet får anteckningen "Faktura … makulerad".
 * Inget bokförs: en annullerad faktura är inte utställd (`isIssued`).
 */
export async function voidDraftInvoice(repos: Repositories, ctx: RedoCtx, invoiceId: InvoiceId): Promise<Invoice> {
  const { inv, option } = await redoOptionFor(repos, ctx.orgId, invoiceId);
  assertOption(option, "void");
  assertInvoiceTransition(inv.status, "CANCELLED");
  await releaseInvoicePosts(repos, inv.id);
  const updated = await repos.invoices.update(inv.id, { status: "CANCELLED" });
  await logMatterNote(repos, ctx, inv.matterId, invoiceVoidedNote(inv.invoiceNumber));
  return updated;
}

/**
 * Kreditera och gör om (#2260): full kreditnota som hänvisar till originalet
 * (som `createCredit`), originalet CANCELLED, och originalets poster släpps i
 * samma transaktion så att den nya fakturan kan skapas direkt.
 */
export async function creditAndRedoInvoice(repos: Repositories, ctx: RedoCtx, input: CreditInput): Promise<CreditResult> {
  const { option } = await redoOptionFor(repos, ctx.orgId, input.invoiceId);
  assertOption(option, "credit");
  const result = await creditInvoice(repos, ctx, input);
  await releaseInvoicePosts(repos, result.original.id);
  await logMatterNote(repos, ctx, result.original.matterId,
    creditForRedoNote(result.credit.invoiceNumber, result.credit.amount, result.original.invoiceNumber));
  return result;
}
