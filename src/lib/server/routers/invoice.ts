/**
 * Fakturerings-router:
 *   • list/getById — läsning
 *   • createAcconto — skapar ACCONTO-faktura (förskott)
 *   • createFinal — bygger FINAL från time entries + expenses, drar av
 *     valda ACCONTO-fakturor (via InvoiceAccontoDeduction)
 *   • recordPayment — registrerar Payment, auto-markerar PAID/COMPLETED
 *   • createPaymentPlan — knyter avbetalningsplan till en SENT faktura
 *   • cancelPaymentPlan — river planen och återställer invoice.status=SENT
 *   • setStatus — manuell statusändring (SENT/CANCELLED/BAD_DEBT)
 *
 * Invariant: allt är scopat till ctx.orgId via matter-joinen, så en org
 * kan aldrig se/mutera en annan orgs fakturor.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { arvodeInclVatOre, isPaymentPlanSettled } from "@/lib/shared/invoice-calc";
import { canTransition, transitionErrorMessage } from "@/lib/shared/invoice-state-machine";
import { ocrFromInvoiceNumber } from "@/lib/shared/ocr-reference";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { computeRadgivningsavgift } from "@/lib/shared/rattshjalp";
import type { Invoice, Payment, PaymentPlan, WriteOff } from "@/lib/shared/schemas/billing";
import { invoiceStatusSchema, invoiceTypeSchema, type InvoiceStatus } from "@/lib/shared/schemas/enums";
import {
  asId,
  matterIdSchema,
  invoiceIdSchema,
  paymentPlanIdSchema,
  type InvoiceId,
  type OrganizationId,
} from "@/lib/shared/schemas/ids";
import type { Matter } from "@/lib/shared/schemas/matter";
import { computeInvoiceLedger, deriveInvoiceStatus, invoicePartitionViolation } from "@/lib/shared/write-off-calc";
import { emit } from "../events/emit";
import type { Repositories } from "../repositories/repositories";
import { router, orgProcedure } from "../trpc";


// ─── writeOff-helpers (ADR 0007) — håller mutationen under complexity ≤ 8 ──

/** Avvisa avskrivning av en faktura som inte är utställd. Returnerar den smala fakturan. */
function ensureWritableOff<T extends { status?: string } | null>(inv: T): NonNullable<T> {
  if (!inv) throw new TRPCError({ code: "NOT_FOUND" });
  if (inv.status === "DRAFT" || inv.status === "CANCELLED") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Endast utställda fakturor kan skrivas av (ej DRAFT/CANCELLED).",
    });
  }
  return inv as NonNullable<T>;
}

/**
 * Summera fakturans avräkningshinkar (betalt/krediterat/avskrivet) → ledger.
 * Migrerad till repository-sömmen (ADR 0020): typade `sumByInvoice`/
 * `sumCreditNotesFor` i st.f. dynamiska `findMany`-reduce. Den rena matematiken
 * (`computeInvoiceLedger`) + tillståndslogiken bor kvar i routern.
 */
async function gatherInvoiceLedger(
  repos: Repositories,
  orgId: OrganizationId,
  inv: { id: InvoiceId; amount: number },
): Promise<{ paid: number; credited: number; writtenOff: number; ledger: ReturnType<typeof computeInvoiceLedger> }> {
  const paid = await repos.payments.sumByInvoice(inv.id);
  const credited = await repos.invoices.sumCreditNotesFor(inv.id, orgId);
  const writtenOff = await repos.writeOffs.sumByInvoice(inv.id);
  return { paid, credited, writtenOff, ledger: computeInvoiceLedger(inv.amount, paid, credited, writtenOff) };
}

/** Lös avskrivningsbeloppet mot utestående (default = hela återstoden) + vakt. */
function resolveWriteOffAmount(outstanding: number, requested?: number): number {
  if (outstanding <= 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Inget utestående att skriva av — fakturan är redan reglerad eller avskriven.",
    });
  }
  const amount = requested ?? outstanding;
  if (amount > outstanding) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Avskrivningsbeloppet (${amount} öre) överstiger utestående (${outstanding} öre).`,
    });
  }
  return amount;
}

export const invoiceRouter = router({
  list: orgProcedure
    .input(
      z.object({
        matterId: matterIdSchema.optional(),
        invoiceType: invoiceTypeSchema.optional(),
        status: invoiceStatusSchema.optional(),
      }),
    )
    // Migrerad till repository-sömmen (ADR 0020). listForOrg org-scopar +
    // hämtar listvyns include (matter-subset, plan, betalningar, aconto-avdrag).
    .query(({ ctx, input }) => ctx.repos.invoices.listForOrg(ctx.orgId, input)),

  getById: orgProcedure
    .input(z.object({ id: invoiceIdSchema }))
    .query(async ({ ctx, input }) => {
      // Migrerad till repository-sömmen (ADR 0020). getByIdFull org-scopar +
      // hämtar hela detalj-shapen (relations + aconto-avdrag/kredit).
      const inv = await ctx.repos.invoices.getByIdFull(input.id, ctx.orgId);
      if (!inv) throw new TRPCError({ code: "NOT_FOUND" });
      return inv;
    }),

  /** ACCONTO: advokaten anger belopp. Inga time entries/expenses kopplas. */
  /**
   * RÅDGIVNING (#383/#851, rättshjälp del A): klientens betalda rådgivningstimme
   * (1 tim enligt rättshjälpstaxan) som en ACCONTO-klientfaktura + billing-run så
   * den syns i ärendets faktura-lista. Märker `radgivningBetaldAt` så domstolens
   * kostnadsräkning visar text-raden; timmen ingår ALDRIG i KR-totalen.
   *
   * Hålls i DRAFT MED FLIT: rådgivningstimmen är en ADDITIV klientkostnad utöver
   * självrisken och ska ALDRIG dras av på en slutfaktura. Aconto-deduktionerna
   * kräver status SENT (`listAccontoSent` / panelens deduktions-val), så ett
   * DRAFT-aconto exkluderas automatiskt. Idempotent: avvisar om redan registrerad.
   */
  createRadgivning: orgProcedure
    .input(z.object({ matterId: matterIdSchema, hasFTax: z.boolean().optional() }))
    // Migrerad till repository-sömmen (ADR 0020): matters + invoices via typade repos.
    .mutation(({ ctx, input }) =>
      ctx.repos.transaction(async (repos) => {
        const matter = await repos.matters.getByIdInOrg(input.matterId, ctx.orgId);
        if (!matter) throw new TRPCError({ code: "NOT_FOUND" });
        if ((matter as { radgivningBetaldAt?: unknown }).radgivningBetaldAt) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Rådgivningstimmen är redan registrerad för detta ärende." });
        }
        // Rådgivningstimmen är en RIKTIG klientfaktura (STANDARD), inte ett aconto
        // (#853): ärendets första händelse, betalas direkt av klienten → skapas
        // SKICKAD. Brutto (inkl moms) som alla klientfakturor. Dras ALDRIG av.
        const netOre = computeRadgivningsavgift({ ...omitUndefined({ hasFTax: input.hasFTax }) }).beloppExclVatOre;
        const grossOre = arvodeInclVatOre(netOre);
        const vatOre = grossOre - netOre;
        const invoiceNumber = await repos.invoices.nextInvoiceNumber(ctx.orgId);
        const invoice = await repos.invoices.create({
          matterId: input.matterId, invoiceNumber, ocrReference: ocrFromInvoiceNumber(invoiceNumber),
          amount: grossOre, vatOre, vatBreakdown: [{ kind: "arvode", vatRate: 2500, netOre, vatOre }],
          invoiceType: "STANDARD", status: "SENT", invoiceDate: new Date(), dueDate: null,
          notes: "Rådgivningstimme enligt rättshjälpstaxan (1 tim).",
        } satisfies Partial<Invoice>);
        await repos.matters.update(input.matterId, { radgivningBetaldAt: new Date() } satisfies Partial<Matter>);
        await emit.invoiceCreated(ctx, invoice);
        return { invoice, beloppExclVatOre: netOre };
      }),
    ),

  /**
   * FINAL: summerar valda time entries + expenses, drar av valda acconto-
   * fakturor. Allt går i en transaktion så time entries/expenses inte
   * "flaggas som fakturerade" halvvägs om något kraschar.
   */
  /**
   * CREDIT: krediterar en befintlig faktura. Skapar en ny faktura med
   * negativt belopp som pekar tillbaka på originalet, och sätter originalets
   * status till CANCELLED. Kan inte kreditera en redan krediterad eller
   * annullerad faktura.
   */
  createCredit: orgProcedure
    .input(
      z.object({
        /** Valfritt klient-genererat id för kredit-fakturan (demo-generator/fixtures). */
        id: invoiceIdSchema.optional(),
        invoiceId: invoiceIdSchema,
        notes: z.string().optional(),
      }),
    )
    // Migrerad till repository-sömmen (ADR 0020). "Redan krediterad"-kollen via
    // getCreditNoteFor; aktiv plan avbryts via paymentPlans; allt i transaktionen.
    .mutation(({ ctx, input }) =>
      ctx.repos.transaction(async (repos) => {
        const original = await repos.invoices.getByIdInOrg(input.invoiceId, ctx.orgId);
        if (!original) throw new TRPCError({ code: "NOT_FOUND" });
        if (original.invoiceType === "CREDIT") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Kan inte kreditera en kreditfaktura.",
          });
        }
        if (await repos.invoices.getCreditNoteFor(original.id)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Fakturan är redan krediterad.",
          });
        }
        if (original.status === "CANCELLED") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Kan inte kreditera en annullerad faktura.",
          });
        }

        // Om originalet har en aktiv avbetalningsplan: avbryt den
        const plan = await repos.paymentPlans.getByInvoiceId(original.id);
        if (plan && plan.status === "ACTIVE") {
          await repos.paymentPlans.update(plan.id, { status: "CANCELLED" });
        }

        const credit = await repos.invoices.create(omitUndefined({
          id: input.id, // undefined → store genererar
          notes: input.notes,
          matterId: original.matterId,
          invoiceNumber: await repos.invoices.nextInvoiceNumber(ctx.orgId),
          amount: -original.amount,
          invoiceType: "CREDIT",
          status: "SENT", // kreditfaktura är "färdig" direkt
          invoiceDate: new Date(),
          creditedInvoiceId: original.id,
        }) satisfies Partial<Invoice>);

        await repos.invoices.update(original.id, { status: "CANCELLED" });
        return credit;
      }),
    ),

  recordPayment: orgProcedure
    .input(
      z.object({
        invoiceId: invoiceIdSchema,
        amount: z.number().int().min(1),
        paidAt: z.string(),
        note: z.string().optional(),
        /** Extern betalningsreferens (camt-import #181) — för idempotent re-import. */
        reference: z.string().optional(),
      }),
    )
    // Migrerad till repository-sömmen (ADR 0020). Tillståndsmaskinen + ledger-
    // matematiken bor kvar här; reads/writes går via typade repos i transaktionen.
    .mutation(({ ctx, input }) =>
      ctx.repos.transaction(async (repos) => {
        const inv = await repos.invoices.getByIdInOrg(input.invoiceId, ctx.orgId);
        if (!inv) throw new TRPCError({ code: "NOT_FOUND" });

        // Tillståndsmaskin (#350, [ADR 0015]): en CANCELLED-faktura kan aldrig
        // betalas. En DRAFT auto-skickas vid första betalningen (kräver-auto-SENT
        // -varianten) så att PAID aldrig uppstår utan att ha passerat SENT.
        if (inv.status === "CANCELLED") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Kan inte registrera betalning på en annullerad faktura.",
          });
        }
        if (inv.status === "DRAFT") {
          await repos.invoices.update(inv.id, { status: "SENT" });
        }

        // Konsistens-skydd (ADR 0007): en betalning får inte översumera fakturan
        // (betalt + krediterat + avskrivet > belopp → utestående < 0). Validera
        // FÖRE skapandet så vi inte lämnar en partition-brytande rad.
        const { paid, credited, writtenOff } = await gatherInvoiceLedger(repos, ctx.orgId, inv);
        const afterLedger = computeInvoiceLedger(inv.amount, paid + input.amount, credited, writtenOff);
        const violation = invoicePartitionViolation(inv.amount, afterLedger);
        if (violation) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Betalningen kan inte registreras: ${violation}` });
        }

        const payment = await repos.payments.create(omitUndefined({
          invoiceId: inv.id,
          amount: input.amount,
          paidAt: new Date(input.paidAt),
          note: input.note,
          reference: input.reference,
          recordedById: asId<"UserId">(ctx.user.id),
        }) satisfies Partial<Payment>);

        // `paid` = betalt FÖRE denna betalning (sumByInvoice) → + input.amount.
        const paidSum = paid + input.amount;

        if (isPaymentPlanSettled(inv.amount, paidSum)) {
          await repos.invoices.update(inv.id, { status: "PAID" });
          const plan = await repos.paymentPlans.getByInvoiceId(inv.id);
          if (plan) {
            await repos.paymentPlans.update(plan.id, { status: "COMPLETED" });
          }
        }
        return { payment, paidSum, settled: isPaymentPlanSettled(inv.amount, paidSum) };
      }),
    ),

  createPaymentPlan: orgProcedure
    .input(
      z.object({
        /** Valfritt klient-genererat id (demo-generator/fixtures) → annars genererar store:n. */
        id: paymentPlanIdSchema.optional(),
        invoiceId: invoiceIdSchema,
        monthlyAmount: z.number().int().min(1),
        dayOfMonth: z.number().int().min(1).max(28),
        startDate: z.string(),
        notes: z.string().optional(),
      }),
    )
    // Migrerad till repository-sömmen (ADR 0020). Planen läses via
    // getByInvoiceId; en gammal CANCELLED-plan hårdraderas (invoiceId @unique →
    // medvetet ADR 0017-undantag, se Repository.hardDelete).
    .mutation(({ ctx, input }) =>
      ctx.repos.transaction(async (repos) => {
        const inv = await repos.invoices.getByIdInOrg(input.invoiceId, ctx.orgId);
        if (!inv) throw new TRPCError({ code: "NOT_FOUND" });
        const existing = await repos.paymentPlans.getByInvoiceId(inv.id);
        if (existing && existing.status === "ACTIVE") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "En aktiv avbetalningsplan finns redan för denna faktura.",
          });
        }
        if (inv.status !== "SENT") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Endast SENT-fakturor kan få en avbetalningsplan.",
          });
        }

        // Om en gammal CANCELLED-plan finns, ta bort den först — `invoiceId`
        // är @unique på PaymentPlan så vi kan inte ha två rader.
        if (existing && existing.status !== "ACTIVE") {
          await repos.paymentPlans.hardDelete(existing.id);
        }

        const plan = await repos.paymentPlans.create(omitUndefined({
          id: input.id, // undefined → store genererar
          notes: input.notes,
          invoiceId: inv.id,
          monthlyAmount: input.monthlyAmount,
          dayOfMonth: input.dayOfMonth,
          startDate: new Date(input.startDate),
          // Explicit (Prisma schema-default appliceras inte av in-memory-store:n).
          status: "ACTIVE",
        }) satisfies Partial<PaymentPlan>);
        await repos.invoices.update(inv.id, { status: "INSTALLMENT_PLAN" });
        return plan;
      }),
    ),

  cancelPaymentPlan: orgProcedure
    .input(z.object({ planId: paymentPlanIdSchema }))
    // Migrerad till repository-sömmen (ADR 0020). Transaktionen korsar två repos
    // (paymentPlans + invoices); getByIdInOrg org-scopar via faktura→ärende.
    .mutation(({ ctx, input }) =>
      ctx.repos.transaction(async (repos) => {
        const plan = await repos.paymentPlans.getByIdInOrg(input.planId, ctx.orgId);
        if (!plan) throw new TRPCError({ code: "NOT_FOUND" });
        await repos.paymentPlans.update(plan.id, { status: "CANCELLED" });
        await repos.invoices.update(plan.invoiceId, { status: "SENT" });
        return { ok: true };
      }),
    ),

  /**
   * Boka en konstaterad kundförlust (ADR 0007). Skapar en daterad WriteOff-post
   * (sanningskällan) och persisterar härledd `BAD_DEBT` när återstoden stängs.
   *
   * Vakt (räkna-en-gång): endast utställda fakturor med utestående > 0; en redan
   * reglerad/avskriven faktura (outstanding ≤ 0) avvisas → en "dålig" faktura
   * räknas exakt en gång. Avskrivningsbeloppet får inte överstiga utestående.
   *
   * `amount` default = hela återstoden (`amount − betalt − krediterat − redan avskrivet`).
   */
  writeOff: orgProcedure
    .input(
      z.object({
        invoiceId: invoiceIdSchema,
        amount: z.number().int().min(1).optional(),
        reason: z.string().optional(),
        writtenOffAt: z.string().optional(),
      }),
    )
    // Migrerad till repository-sömmen (ADR 0020). Ledger-läsningarna är typade
    // repo-metoder; ADR 0007-vakterna (ensureWritableOff/resolveWriteOffAmount)
    // + status-härledningen bor kvar i routern.
    .mutation(({ ctx, input }) =>
      ctx.repos.transaction(async (repos) => {
        const inv = ensureWritableOff(await repos.invoices.getByIdInOrg(input.invoiceId, ctx.orgId));

        const { paid, credited, writtenOff, ledger } = await gatherInvoiceLedger(repos, ctx.orgId, inv);
        const amount = resolveWriteOffAmount(ledger.outstanding, input.amount);

        const writeOff = await repos.writeOffs.create(omitUndefined({
          invoiceId: inv.id,
          amount,
          writtenOffAt: input.writtenOffAt ? new Date(input.writtenOffAt) : new Date(),
          reason: input.reason,
          recordedById: asId<"UserId">(ctx.user.id),
        }) satisfies Partial<WriteOff>);

        // Härled status efter avskrivningen och persistera om återstoden stängdes.
        const after = computeInvoiceLedger(inv.amount, paid, credited, writtenOff + amount);
        const derived = deriveInvoiceStatus(inv.status as InvoiceStatus, after);
        if (derived !== inv.status) {
          await repos.invoices.update(inv.id, { status: derived });
        }

        await emit.invoiceWrittenOff(ctx, inv.id, inv.matterId, amount);
        return { writeOff, outstanding: after.outstanding, status: derived };
      }),
    ),

  /**
   * Manuell statusändring för DRAFT→SENT, SENT→CANCELLED, SENT→BAD_DEBT.
   *
   * BAD_DEBT via `setStatus` är LEGACY (sätter bara flaggan, ingen daterad post).
   * ADR 0007:s väg är `writeOff` ovan, som skapar en WriteOff-post + härleder
   * status. UI-knappen "Kundförlust" byts till `writeOff` separat; tills dess
   * lever båda vägarna (gamla BAD_DEBT-rader migreras i #139).
   */
  setStatus: orgProcedure
    .input(
      z.object({
        invoiceId: invoiceIdSchema,
        status: invoiceStatusSchema.extract(["SENT", "CANCELLED", "BAD_DEBT"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Migrerad till repository-sömmen (ADR 0020). Statemaskinen stannar i routern.
      const inv = await ctx.repos.invoices.getByIdInOrg(input.invoiceId, ctx.orgId);
      if (!inv) throw new TRPCError({ code: "NOT_FOUND" });
      // Tillståndsmaskin (#350): blockera omöjliga övergångar (t.ex. DRAFT→BAD_DEBT
      // utan att ha skickats). Se [ADR 0015].
      if (!canTransition(inv.status as InvoiceStatus, input.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: transitionErrorMessage(inv.status as InvoiceStatus, input.status) });
      }
      return ctx.repos.invoices.update(input.invoiceId, { status: input.status });
    }),

  /**
   * Märk en faktura som bokförd i Fortnox (#82). Anropas av server-runtime:ns
   * Fortnox-connector efter en lyckad verifikat-push; `fortnoxId` =
   * "<VoucherSeries>/<VoucherNumber>".
   *
   * IDEMPOTENT: skriver ALDRIG över en redan satt `fortnoxId` — det är
   * dubbelbokförings-skyddet (en omkörd peer-cykel får inte boka om). Redan
   * märkt → returnera oförändrad rad.
   */
  markFortnoxBooked: orgProcedure
    .input(z.object({ invoiceId: invoiceIdSchema, fortnoxId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      // Migrerad till repository-sömmen (ADR 0020). Org-scope via getByIdInOrg.
      const inv = await ctx.repos.invoices.getByIdInOrg(input.invoiceId, ctx.orgId);
      if (!inv) throw new TRPCError({ code: "NOT_FOUND" });
      if (inv.fortnoxId) return inv; // redan bokförd → no-op (idempotens)
      return ctx.repos.invoices.update(input.invoiceId, { fortnoxId: input.fortnoxId });
    }),
});
