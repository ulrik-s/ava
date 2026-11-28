/**
 * Fakturerings-router:
 *   • list/getById — läsning
 *   • createAcconto — skapar ACCONTO-faktura (förskott)
 *   • createFinal — bygger FINAL från time entries + expenses, drar av
 *     valda ACCONTO-fakturor (via InvoiceAccontoDeduction)
 *   • recordPayment — registrerar Payment, auto-markerar PAID/COMPLETED
 *   • createPaymentPlan — knyter avbetalningsplan till en SENT faktura
 *   • cancelPaymentPlan — river planen och återställer invoice.status=SENT
 *   • setStatus — manuell statusändring (SENT, makulera utkast); kundförlust via writeOff
 *   • createCredit / creditAndRedo / voidDraft — kreditera, gör om, makulera (#2260)
 *
 * Invariant: allt är scopat till ctx.orgId via matter-joinen, så en org
 * kan aldrig se/mutera en annan orgs fakturor.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { creditCreatedNote, invoiceStatusNote, radgivningInvoicedNote } from "@/lib/shared/billing/billing-notes";
import { arvodeInclVatOre, isPaymentPlanSettled } from "@/lib/shared/billing/invoice-calc";
import { ISSUED_CANCEL_REASON } from "@/lib/shared/billing/invoice-redo";
import { canTransition, transitionErrorMessage } from "@/lib/shared/billing/invoice-state-machine";
import { RADGIVNING_INVOICE_NOTES } from "@/lib/shared/billing/radgivning-entry";
import { computeRadgivningsavgift, RADGIVNING_DESCRIPTION, type Radgivningsavgift } from "@/lib/shared/billing/rattshjalp";
import { CURRENT_ROUNDING, roundToKronor } from "@/lib/shared/billing/whole-kronor";
import { computeInvoiceLedger, deriveInvoiceStatus, invoicePartitionViolation } from "@/lib/shared/billing/write-off-calc";
import { ledgerRefOf } from "@/lib/shared/ledger-ref";
import { ocrFromInvoiceNumber } from "@/lib/shared/ocr-reference";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { pageEnvelope } from "@/lib/shared/paginate";
import type { Invoice, Payment, PaymentPlan, TimeEntry, WriteOff } from "@/lib/shared/schemas/billing";
import { isoDateOrDateTimeInput } from "@/lib/shared/schemas/common";
import { invoiceStatusSchema, invoiceTypeSchema } from "@/lib/shared/schemas/enums";
import {
  asId,
  matterIdSchema,
  invoiceIdSchema,
  paymentPlanIdSchema,
  userIdSchema,
  type InvoiceId,
  type MatterId,
  type OrganizationId,
  type UserId,
} from "@/lib/shared/schemas/ids";
import type { Matter } from "@/lib/shared/schemas/matter";
import { stockholmYear } from "@/lib/shared/stockholm-time";
import { requireUserInOrg } from "../auth/org-scope";
import { assertSetupFieldsAllowed, onBehalfOf, type SetupFieldCaller } from "../auth/setup-fields";
import { creditInvoice } from "../billing/credit-invoice";
import { gatherInvoiceLedger } from "../billing/invoice-ledger";
import { logMatterNote } from "../billing/matter-note";
import { creditAndRedoInvoice, voidDraftInvoice } from "../billing/redo-invoice";
import { emit } from "../events/emit";
import { dateOrCallTime, newRowId, type QueuedCallScope } from "../queued-call";
import type { Repositories } from "../repositories/repositories";
import { router, adminProcedure, orgProcedure } from "../trpc";

/** Krediteringens indata (`createCredit`, `creditAndRedo`). */
const creditInputSchema = z.object({
  /** Valfritt klient-genererat id för kredit-fakturan (demo-generator/fixtures). */
  id: invoiceIdSchema.optional(),
  invoiceId: invoiceIdSchema,
  notes: z.string().optional(),
});

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
  return inv;
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

/**
 * Rådgivningstimmens tidspost (#1205): 60 min arbete på rådgivningsnormen, redan
 * fakturerad → låst (`frozenAt`) och kopplad till rådgivningsfakturan (`invoiceId`,
 * samma länk som slutregleringen sätter med `flagBilled`). Ingen billing-run: en
 * FINAL-körning hade flyttat ärendets fakturerings-fas. Låsregeln: `isLockedEntry`.
 */
async function createRadgivningEntry(repos: Repositories, a: {
  matterId: MatterId; invoiceId: InvoiceId; userId: UserId; when: Date; avgift: Radgivningsavgift; scope: QueuedCallScope;
}): Promise<TimeEntry> {
  return repos.timeEntries.create({
    id: asId<"TimeEntryId">(newRowId(a.scope, "radgivningEntry")),
    matterId: a.matterId, userId: a.userId, date: a.when,
    minutes: a.avgift.minutes, description: RADGIVNING_DESCRIPTION, hourlyRate: a.avgift.rateOrePerH,
    kind: "ARBETE", billable: true, invoiceId: a.invoiceId, frozenAt: a.when,
  } satisfies Partial<TimeEntry>);
}

/**
 * Juristen som höll rådgivningsmötet (#1345): anroparen, eller — för ADMIN i
 * ett direkt anrop — en kollega i samma byrå (`setup-fields.ts`).
 */
async function radgivningOwner(
  ctx: SetupFieldCaller & { orgId: OrganizationId }, repos: Repositories, userId: UserId | undefined,
): Promise<UserId> {
  assertSetupFieldsAllowed(ctx, { userId: onBehalfOf(ctx, userId) });
  return userId ? (await requireUserInOrg({ repos, orgId: ctx.orgId }, userId)).id : ctx.user.id;
}

export const invoiceRouter = router({
  list: orgProcedure
    .input(
      z.object({
        matterId: matterIdSchema.optional(),
        invoiceType: invoiceTypeSchema.optional(),
        status: invoiceStatusSchema.optional(),
        // Frivillig sidning (#1011): utelämnad pageSize = hela listan, som förut.
        page: z.number().min(1).optional(),
        pageSize: z.number().min(1).max(100).optional(),
      }),
    )
    // Migrerad till repository-sömmen (ADR 0020). listForOrg org-scopar +
    // hämtar listvyns include (matter-subset, plan, betalningar, aconto-avdrag).
    .query(async ({ ctx, input }) => pageEnvelope(await ctx.repos.invoices.listForOrg(ctx.orgId, input), input)),

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
   *
   * Mötet registreras samtidigt som en LÅST tidspost (#1205) kopplad till fakturan
   * — den syns i tidslistan som "Låst" och ingår aldrig i kostnadsräkning,
   * slutreglering, aconto eller "upparbetat ofakturerat".
   */
  createRadgivning: orgProcedure
    .input(z.object({
      matterId: matterIdSchema, hasFTax: z.boolean().optional(),
      /** Mötesdagen; en dag eller tidpunkt som går att tolka (#1362). */
      invoiceDate: isoDateOrDateTimeInput.optional(),
      /** Förfallodatum (demo/fixtures) — utelämnat saknar fakturan ett. Aldrig `Invalid Date` (#1362). */
      dueDate: isoDateOrDateTimeInput.optional(),
      /** Juristen som höll mötet (tidspostens ägare). Default: inloggad användare.
       *  Setup-fält för demo-generatorn/fixtures (ADR 0003), jfr timeEntry.create:
       *  bara ADMIN, aldrig via kön (`setup-fields.ts`, #1345). */
      userId: userIdSchema.optional(),
    }))
    // Migrerad till repository-sömmen (ADR 0020): matters + invoices via typade repos.
    .mutation(({ ctx, input }) =>
      ctx.repos.transaction(async (repos) => {
        const owner = await radgivningOwner(ctx, repos, input.userId);
        const matter = await repos.matters.getByIdInOrg(input.matterId, ctx.orgId);
        if (!matter) throw new TRPCError({ code: "NOT_FOUND" });
        if ((matter as { radgivningBetaldAt?: unknown }).radgivningBetaldAt) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Rådgivningstimmen är redan registrerad för detta ärende." });
        }
        // Rådgivningstimmen är en RIKTIG klientfaktura (STANDARD), inte ett aconto
        // (#853): ärendets första händelse, betalas direkt av klienten → skapas
        // SKICKAD. Brutto (inkl moms) som alla klientfakturor. Dras ALDRIG av.
        // Datum = mötesdagen om angivet (#880: rådgivning faktureras samma dag som mötet), annars idag.
        const when = dateOrCallTime(ctx, input.invoiceDate);
        // Norm efter mötesdagen (#897): rådgivning i nov 2025 → 2025 års timkostnadsnorm.
        const avgift = computeRadgivningsavgift({ ...omitUndefined({ hasFTax: input.hasFTax }), date: when });
        // Fakturans enda rad → hela kronor (#1438), momsen på den.
        const netOre = roundToKronor(avgift.beloppExclVatOre);
        const grossOre = arvodeInclVatOre(netOre);
        const vatOre = grossOre - netOre;
        const invoiceNumber = await repos.invoices.nextInvoiceNumber(ctx.orgId, stockholmYear(when));
        const invoice = await repos.invoices.create({
          id: asId<"InvoiceId">(newRowId(ctx, "invoice")),
          matterId: input.matterId, invoiceNumber, ocrReference: ocrFromInvoiceNumber(invoiceNumber),
          amount: grossOre, vatOre, vatBreakdown: [{ kind: "arvode", vatRate: 2500, netOre, vatOre }], amountRounding: CURRENT_ROUNDING,
          invoiceType: "STANDARD", status: "DRAFT", invoiceDate: when, // "Skapad" tills den skickas (#1138)
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          notes: RADGIVNING_INVOICE_NOTES, purpose: "RADGIVNING",
        } satisfies Partial<Invoice>);
        await repos.matters.update(input.matterId, { radgivningBetaldAt: when } satisfies Partial<Matter>);
        await logMatterNote(repos, ctx, input.matterId, radgivningInvoicedNote(invoice.invoiceNumber, grossOre), when);
        await emit.invoiceCreated(ctx, invoice);
        const entry = await createRadgivningEntry(repos, {
          matterId: input.matterId, invoiceId: invoice.id, userId: owner, when, avgift, scope: ctx,
        });
        await emit.timeEntryAdded(ctx, entry);
        return { invoice, beloppExclVatOre: netOre };
      }),
    ),

  /**
   * CREDIT: krediterar en befintlig faktura (`creditInvoice`): en ny faktura med
   * negativt belopp som pekar tillbaka på originalet, och originalet blir
   * CANCELLED. Kan inte kreditera en redan krediterad eller annullerad faktura.
   */
  createCredit: orgProcedure
    .input(creditInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.repos.transaction(async (repos) => {
        const { credit, original } = await creditInvoice(repos, ctx, input);
        await logMatterNote(repos, ctx, original.matterId, creditCreatedNote(credit.invoiceNumber, credit.amount, original.invoiceNumber));
        return credit;
      }),
    ),

  /**
   * "Fel på fakturan?" → Kreditera och gör om (#2260): kreditnota som hänvisar
   * till originalet, och originalets tidsposter, utlägg och körning släpps i
   * samma transaktion så att en ny faktura kan skapas direkt.
   */
  creditAndRedo: orgProcedure
    .input(creditInputSchema)
    .mutation(({ ctx, input }) => ctx.repos.transaction(async (repos) => (await creditAndRedoInvoice(repos, ctx, input)).credit)),

  /**
   * "Fel på fakturan?" → Makulera (#2260): ett obokfört utkast blir CANCELLED med
   * numret kvar, och dess poster och körning släpps. Ett bokfört utkast avvisas.
   */
  voidDraft: orgProcedure
    .input(z.object({ invoiceId: invoiceIdSchema }))
    .mutation(({ ctx, input }) => ctx.repos.transaction((repos) => voidDraftInvoice(repos, ctx, input.invoiceId))),

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
          id: asId<"PaymentId">(newRowId(ctx, "payment")),
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
        writtenOffAt: isoDateOrDateTimeInput.optional(),
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
          id: asId<"WriteOffId">(newRowId(ctx, "writeOff")),
          invoiceId: inv.id,
          amount,
          writtenOffAt: dateOrCallTime(ctx, input.writtenOffAt),
          reason: input.reason,
          recordedById: asId<"UserId">(ctx.user.id),
        }) satisfies Partial<WriteOff>);

        // Härled status efter avskrivningen och persistera om återstoden stängdes.
        const after = computeInvoiceLedger(inv.amount, paid, credited, writtenOff + amount);
        const derived = deriveInvoiceStatus(inv.status, after);
        if (derived !== inv.status) {
          await repos.invoices.update(inv.id, { status: derived });
        }

        await emit.invoiceWrittenOff(ctx, inv.id, inv.matterId, amount);
        return { writeOff, outstanding: after.outstanding, status: derived };
      }),
    ),

  /**
   * Manuell statusändring: DRAFT→SENT, och DRAFT→CANCELLED som makulerar utkastet
   * (`voidDraftInvoice`, #2260). En utställd faktura annulleras aldrig utan
   * kreditnota (ML 17 kap. 22–23 §§) — den krediteras (`creditAndRedo`).
   * Kundförlust registreras via `writeOff` (ADR 0007).
   */
  setStatus: orgProcedure
    .input(
      z.object({
        invoiceId: invoiceIdSchema,
        status: invoiceStatusSchema.extract(["SENT", "CANCELLED"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Migrerad till repository-sömmen (ADR 0020). Statemaskinen stannar i routern.
      const inv = await ctx.repos.invoices.getByIdInOrg(input.invoiceId, ctx.orgId);
      if (!inv) throw new TRPCError({ code: "NOT_FOUND" });
      // Tillståndsmaskin (#350): blockera omöjliga övergångar (t.ex. PAID→SENT
      // för en redan betald faktura). Se [ADR 0015].
      if (!canTransition(inv.status, input.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: transitionErrorMessage(inv.status, input.status) });
      }
      if (input.status === "CANCELLED" && inv.status !== "CANCELLED") {
        // Bara ett utkast makuleras; en utställd faktura krediteras (#2260).
        if (inv.status !== "DRAFT") throw new TRPCError({ code: "BAD_REQUEST", message: ISSUED_CANCEL_REASON });
        return ctx.repos.transaction((repos) => voidDraftInvoice(repos, ctx, inv.id));
      }
      return ctx.repos.transaction(async (repos) => {
        const updated = await repos.invoices.update(input.invoiceId, { status: input.status });
        await logMatterNote(repos, ctx, inv.matterId, invoiceStatusNote(inv.invoiceNumber, input.status));
        return updated;
      });
    }),

  /**
   * Märk en faktura som bokförd i Fortnox (#82). Anropas av server-runtime:ns
   * Fortnox-connector efter en lyckad verifikat-push; `fortnoxId` =
   * "<VoucherSeries>/<VoucherNumber>".
   *
   * IDEMPOTENT: skriver ALDRIG över en redan satt `fortnoxId` — det är
   * dubbelbokförings-skyddet (en omkörd peer-cykel får inte boka om). Redan
   * märkt → returnera oförändrad rad.
   *
   * Bara administratör (#1450): ett påhittat id stoppar annars den riktiga
   * bokföringen, eftersom ett satt id aldrig skrivs över.
   */
  markFortnoxBooked: adminProcedure
    .input(z.object({ invoiceId: invoiceIdSchema, fortnoxId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const inv = await ctx.repos.invoices.getByIdInOrg(input.invoiceId, ctx.orgId); // org-scope (ADR 0020)
      if (!inv) throw new TRPCError({ code: "NOT_FOUND" });
      if (ledgerRefOf(inv) !== null) return inv; // redan bokförd → no-op (idempotens)
      return ctx.repos.invoices.update(input.invoiceId, { fortnoxId: input.fortnoxId });
    }),
});
