/**
 * Kreditering av en faktura (`invoice.createCredit`, och "Kreditera och gör om"
 * #2260): en ny CREDIT-faktura med negativt belopp som pekar på originalet
 * (`creditedInvoiceId`), och originalet blir CANCELLED. Flyttad ur
 * `routers/invoice.ts` (#2176, routertaket); beloppen räknas som förut.
 */

import { TRPCError } from "@trpc/server";
import { assertInvoiceTransition } from "@/lib/shared/billing/invoice-state-machine";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import type { Invoice } from "@/lib/shared/schemas/billing";
import type { InvoiceId, OrganizationId } from "@/lib/shared/schemas/ids";
import { stockholmYear } from "@/lib/shared/stockholm-time";
import { callTime, type QueuedCallScope } from "../queued-call";
import type { Repositories } from "../repositories/repositories";

/**
 * Kreditnotans moms + uppdelning: originalets, med omvända tecken (#977).
 *
 * En kreditnota ska spegla den faktura den avser post för post — samma konton,
 * samma momssatser, motsatt riktning. Saknar originalet uppdelning (rader från
 * före #782) speglar vi bara `vatOre`; då får verifikatet falla tillbaka på
 * enkelrads-vägen precis som originalet gjorde.
 */
function mirroredCreditAmounts(original: Pick<Invoice, "vatOre" | "vatBreakdown" | "amountRounding">): Partial<Invoice> {
  const lines = original.vatBreakdown ?? [];
  // Krediteringen avrundas som originalet (#1438) — den räknas aldrig om.
  const amountRounding = original.amountRounding ?? undefined;
  return omitUndefined({
    amountRounding,
    vatOre: original.vatOre == null ? undefined : -original.vatOre,
    vatBreakdown: lines.length === 0
      ? undefined
      : lines.map((l) => ({ ...l, netOre: -l.netOre, vatOre: -l.vatOre })),
  });
}

/** Avvisa det som inte kan krediteras: en kreditfaktura, en redan krediterad eller en annullerad. */
async function assertCreditable(repos: Repositories, original: Invoice): Promise<void> {
  const reason = original.invoiceType === "CREDIT"
    ? "Kan inte kreditera en kreditfaktura."
    : await repos.invoices.getCreditNoteFor(original.id) ? "Fakturan är redan krediterad."
      : original.status === "CANCELLED" ? "Kan inte kreditera en annullerad faktura." : null;
  if (reason) throw new TRPCError({ code: "BAD_REQUEST", message: reason });
  // Tillståndsmaskinen (ADR 0015): kreditering annullerar originalet.
  assertInvoiceTransition(original.status, "CANCELLED");
}

/** Det krediteringen behöver ur anropet. */
export interface CreditInput {
  /** Valfritt klient-genererat id för kredit-fakturan (demo-generator/fixtures, köade anrop). */
  id?: InvoiceId | undefined;
  invoiceId: InvoiceId;
  notes?: string | undefined;
}

/** Kreditnotan och originalet (före annulleringen). */
export interface CreditResult {
  credit: Invoice;
  original: Invoice;
}

/**
 * Kreditera fakturan inne i anroparens transaktion. En aktiv avbetalningsplan
 * avbryts. Kreditnotan skapas SKICKAD ("färdig") med nästa nummer i serien och
 * speglar originalet post för post; originalet blir CANCELLED. Anteckningen i
 * ärendet skriver anroparen.
 */
export async function creditInvoice(
  repos: Repositories, ctx: QueuedCallScope & { orgId: OrganizationId }, input: CreditInput,
): Promise<CreditResult> {
  const original = await repos.invoices.getByIdInOrg(input.invoiceId, ctx.orgId);
  if (!original) throw new TRPCError({ code: "NOT_FOUND" });
  await assertCreditable(repos, original);

  const plan = await repos.paymentPlans.getByInvoiceId(original.id);
  if (plan && plan.status === "ACTIVE") await repos.paymentPlans.update(plan.id, { status: "CANCELLED" });

  const creditDate = callTime(ctx);
  const credit = await repos.invoices.create(omitUndefined({
    id: input.id, // undefined → store genererar
    notes: input.notes,
    matterId: original.matterId,
    invoiceNumber: await repos.invoices.nextInvoiceNumber(ctx.orgId, stockholmYear(creditDate)),
    amount: -original.amount,
    // Kreditnotan speglar originalet POST FÖR POST (#977): samma konton och
    // momssatser, omvända tecken.
    ...mirroredCreditAmounts(original),
    invoiceType: "CREDIT",
    status: "SENT", // kreditfaktura är "färdig" direkt
    invoiceDate: creditDate,
    creditedInvoiceId: original.id,
  }) satisfies Partial<Invoice>);

  await repos.invoices.update(original.id, { status: "CANCELLED" });
  return { credit, original };
}
