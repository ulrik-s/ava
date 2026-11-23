/**
 * Försäkringsbolagets prutning i billingRun-routern (#1767, steg 2): prutningen
 * efter slutregleringen omfördelas mellan försäkringsfakturan och klientfakturan.
 *
 * Exporteras som ett objekt av procedurer som kompositionen i `billingRun.ts`
 * spreadar in i den platta `billingRunRouter` (samma form som `document/`).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { VatBreakdownLine } from "@/lib/shared/accounting/semantic-voucher";
import { insurerPruningNote } from "@/lib/shared/billing-notes";
import { arvodeInclVatOre } from "@/lib/shared/invoice-calc";
import { hasVatBreakdown, invoiceVatOre } from "@/lib/shared/invoice-vat";
import type { Invoice } from "@/lib/shared/schemas/billing";
import { isoDateOrDateTimeInput } from "@/lib/shared/schemas/common";
import { matterIdSchema, type MatterId, type OrganizationId } from "@/lib/shared/schemas/ids";
import type { SettlementRowKind, SettlementView } from "@/lib/shared/settlement-view";
import { DEFAULT_VAT_RATE } from "@/lib/shared/vat";
import { roundingOf } from "@/lib/shared/whole-kronor";
import { logMatterNote } from "../../billing/matter-note";
import { emit } from "../../events/emit";
import { dateOrCallTime } from "../../queued-call";
import type { BillingRunListRow } from "../../repositories/billing-run-repository";
import type { Repositories } from "../../repositories/repositories";
import { orgProcedure } from "../../trpc";

export const pruningProcedures = {
  /**
   * Registrera försäkringsbolagets PRUTNING efter slutregleringen (#905/#952,
   * rättsskydd, flöde B): bolaget ersätter mindre än fakturerat. Prutningen bärs
   * av KLIENTEN — byrån blir hel.
   *
   * INGEN kreditfaktura till försäkringsbolaget. I rättsskydd GÅR fakturan till
   * bolaget men är STÄLLD TILL KLIENTEN: det gick aldrig ut någon faktura *till*
   * bolaget, och därmed finns inget att kreditera dem. Klienten har två fakturor
   * efter slutregleringen — självrisk-fakturan och den som försäkringen betalar —
   * och prutningen ändrar bara FÖRDELNINGEN mellan dem:
   *
   *   försäkringsfakturan  −prutningen (inkl moms)
   *   klientfakturan       +prutningen (inkl moms)
   *
   * Totalen är oförändrad och inga nya fakturor uppstår. Kräver en befintlig
   * FORSAKRING-slutregleringsfaktura + klientens slutregleringsfaktura.
   */
  recordInsurerPruning: orgProcedure
    .input(z.object({
      matterId: matterIdSchema,
      /** Prutat arvode NETTO (öre) — den del försäkringen inte ersätter. */
      prunedNetOre: z.number().int().positive(),
      /** Bokföringsdatum för omfördelningen (demo/fixtures) — annars idag. */
      invoiceDate: isoDateOrDateTimeInput.optional(),
      notes: z.string().nullish(),
    }))
    .mutation(({ ctx, input }) =>
      ctx.repos.transaction(async (tx) => {
        const t = await resolvePruningTargets(tx, ctx.orgId, input.matterId);
        // Bolagets prutning tas som den är; momsen på den avrundas som fakturans rader (#1438).
        const prunedGross = arvodeInclVatOre(input.prunedNetOre, roundingOf(t.payerInvoice));
        const prunedVat = prunedGross - input.prunedNetOre;
        if (prunedGross > t.payerInvoice.amount) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Prutningen (${prunedGross / 100} kr inkl moms) är större än försäkringsfakturan (${t.payerInvoice.amount / 100} kr).`,
          });
        }
        const when = dateOrCallTime(ctx, input.invoiceDate);
        const payerInvoice = await tx.invoices.update(t.payerInvoice.id, shiftInvoiceAmount(t.payerInvoice, -input.prunedNetOre, -prunedVat, {
          label: "Avgår försäkringens prutning — faktureras klienten (exkl moms)", kind: "deduct",
        }));
        const clientInvoice = await tx.invoices.update(t.clientInvoice.id, shiftInvoiceAmount(t.clientInvoice, input.prunedNetOre, prunedVat, {
          label: "Försäkringens prutning — bärs av klienten (exkl moms)", kind: "add",
        }));
        // Körningarna följer sina fakturor så rapporter/AR summerar rätt, och
        // prutningen märks på betalar-körningen (`prutningOre`) → UI:t vet att den
        // är registrerad utan att det finns någon CREDIT att leta efter.
        await tx.billingRuns.update(t.payerRun.id, {
          amountOre: payerInvoice.amount, prutningOre: -input.prunedNetOre,
          notes: input.notes ?? `Försäkringens prutning ${input.prunedNetOre / 100} kr (exkl moms) — omfördelad till klientfakturan ${clientInvoice.invoiceNumber ?? ""}`.trim(),
        });
        await tx.billingRuns.update(t.clientRun.id, { amountOre: clientInvoice.amount });
        await logMatterNote(tx, ctx, input.matterId, insurerPruningNote(input.prunedNetOre, clientInvoice.invoiceNumber), when);
        await emit.invoiceAdjusted(ctx, payerInvoice, "insurer_pruning");
        await emit.invoiceAdjusted(ctx, clientInvoice, "insurer_pruning");
        return { payerInvoice, clientInvoice, prunedGross, adjustedAt: when };
      }),
    ),
};

/** Slutregleringens två fakturor i ett rättsskyddsärende — båda ställda till klienten. */
interface PruningTargets {
  payerRun: BillingRunListRow;
  payerInvoice: Invoice;
  clientRun: BillingRunListRow;
  clientInvoice: Invoice;
}

/**
 * Hitta de två fakturorna prutningen omfördelas mellan (#952). Båda måste finnas:
 * utan försäkringsfakturan finns inget att pruta på, och utan klientfakturan finns
 * ingen att flytta beloppet till (då vore prutningen en ren förlust, vilket den inte
 * är i rättsskydd). Senaste körningen per mottagare vinner om flera finns.
 */
async function resolvePruningTargets(tx: Repositories, orgId: OrganizationId, matterId: MatterId): Promise<PruningTargets> {
  const runs = await tx.billingRuns.listForOrg(orgId, matterId);
  const finals = runs.filter((r) => r.type === "FINAL" && r.invoiceId);
  const payerRun = finals.find((r) => r.recipient === "FORSAKRING");
  if (!payerRun?.invoiceId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Ingen försäkringsfaktura att pruta på — slutreglera mot försäkringen först." });
  }
  const clientRun = finals.find((r) => r.recipient === "KLIENT");
  if (!clientRun?.invoiceId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Ingen klientfaktura att omfördela prutningen till — slutreglera ärendet först." });
  }
  const [payerInvoice, clientInvoice] = await Promise.all([
    tx.invoices.getByIdInOrg(payerRun.invoiceId, orgId),
    tx.invoices.getByIdInOrg(clientRun.invoiceId, orgId),
  ]);
  if (!payerInvoice || !clientInvoice) throw new TRPCError({ code: "NOT_FOUND", message: "Slutregleringens fakturor kunde inte läsas." });
  return { payerRun, payerInvoice, clientRun, clientInvoice };
}

/**
 * Flytta ett arvode-belopp till/från en faktura (#952): `amount`, `vatOre`,
 * moms-uppdelningen (arvodets 25 %-rad) och nedbrytningsvyn justeras tillsammans,
 * så fakturan aldrig visar en moms som inte hör till dess belopp. `deltaNet` är
 * signerat (negativt = avgår).
 *
 * Momsen utgår från fakturans moms (`invoiceVatOre`, #1807), inte från 0, så en
 * äldre faktura utan `vatOre` får rätt moms efter flytten.
 */
function shiftInvoiceAmount(
  invoice: Invoice, deltaNet: number, deltaVat: number, row: { label: string; kind: SettlementRowKind },
): Partial<Invoice> {
  return {
    amount: invoice.amount + deltaNet + deltaVat,
    vatOre: invoiceVatOre(invoice) + deltaVat,
    ...shiftVatBreakdown(invoice, deltaNet, deltaVat),
    settlementBreakdown: appendBreakdownRow(invoice.settlementBreakdown, row.label, Math.abs(deltaNet), row.kind, deltaNet + deltaVat),
  };
}

/**
 * Uppdelningen justeras bara när fakturan har en (#1807). Saknas den lämnas
 * `vatBreakdown` orörd och `vatOre` bär momsen: en uppdelning med bara deltat
 * skulle få verifikatet att bokföra deltat i stället för fakturans moms.
 */
function shiftVatBreakdown(invoice: Invoice, deltaNet: number, deltaVat: number): Pick<Partial<Invoice>, "vatBreakdown"> {
  if (!hasVatBreakdown(invoice)) return {};
  return { vatBreakdown: shiftArvodeVatLine(invoice.vatBreakdown, deltaNet, deltaVat) };
}

/** Justera arvodets 25 %-rad i moms-uppdelningen; saknas den läggs den till. */
function shiftArvodeVatLine(lines: readonly VatBreakdownLine[], deltaNet: number, deltaVat: number): VatBreakdownLine[] {
  const idx = lines.findIndex((l) => l.kind === "arvode" && l.vatRate === DEFAULT_VAT_RATE);
  if (idx < 0) return [...lines, { kind: "arvode", vatRate: DEFAULT_VAT_RATE, netOre: deltaNet, vatOre: deltaVat }];
  return lines.map((l, i) => (i === idx ? { ...l, netOre: l.netOre + deltaNet, vatOre: l.vatOre + deltaVat } : l));
}

/**
 * Lägg en förklarande rad sist i nedbrytningsvyn och flytta totalen (#952), så
 * fakturadokumentet visar VARFÖR beloppet ändrades. Momsraden får en egen rad
 * eftersom trappan redovisar netto och moms separat.
 */
function appendBreakdownRow(
  view: SettlementView | null | undefined, label: string, netOre: number, kind: SettlementRowKind, deltaGross: number,
): SettlementView {
  const base: SettlementView = view ?? { timeLines: [], rows: [], totalLabel: "Att betala (inkl moms)", totalOre: 0 };
  const vatOre = Math.abs(deltaGross) - netOre;
  return {
    ...base,
    rows: [...base.rows, { label, amountOre: netOre, kind }, { label: "Moms 25 % på omfördelningen", amountOre: vatOre, kind }],
    totalOre: base.totalOre + deltaGross,
  };
}
