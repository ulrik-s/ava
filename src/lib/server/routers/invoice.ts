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
import { computeFinalInvoiceBreakdown, isPaymentPlanSettled } from "@/lib/shared/invoice-calc";
import { canTransition, transitionErrorMessage } from "@/lib/shared/invoice-state-machine";
import { ocrFromInvoiceNumber } from "@/lib/shared/ocr-reference";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { computeRadgivningsavgift } from "@/lib/shared/rattshjalp";
import type { InvoiceStatus } from "@/lib/shared/schemas/enums";
import {
  asId,
  matterIdSchema,
  invoiceIdSchema,
  paymentPlanIdSchema,
  type InvoiceId,
  type TimeEntryId,
  type ExpenseId,
} from "@/lib/shared/schemas/ids";
import { computeInvoiceLedger, deriveInvoiceStatus, invoicePartitionViolation } from "@/lib/shared/write-off-calc";
import type { DataStoreTx } from "../data-store/IDataStore";
import { emit } from "../events/emit";
import { router, orgProcedure } from "../trpc";

// ─── createFinal-hjälpare (validera + koppla poster) ──────────────

/** Hämta valda obetalda tidsposter; kasta om någon redan fakturerats/ägs av annat ärende. */
async function fetchUnbilledTimeEntries(tx: DataStoreTx, matterId: string, ids: string[]) {
  const rows = ids.length
    ? await tx.timeEntries.findMany({
        where: { id: { in: ids }, matterId, invoiceId: null },
        include: { user: { select: { hourlyRate: true } } },
      })
    : [];
  if (rows.length !== ids.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Några tidsposter är redan fakturerade eller tillhör annat ärende." });
  }
  return rows;
}

/** Hämta valda obetalda utlägg; kasta om någon redan fakturerats/ägs av annat ärende. */
async function fetchUnbilledExpenses(tx: DataStoreTx, matterId: string, ids: string[]) {
  const rows = ids.length
    ? await tx.expenses.findMany({ where: { id: { in: ids }, matterId, invoiceId: null } })
    : [];
  if (rows.length !== ids.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Några utlägg är redan fakturerade eller tillhör annat ärende." });
  }
  return rows;
}

/** Validera accontos: samma ärende, typ ACCONTO, ej redan avdragna på en FINAL. */
async function fetchDeductibleAccontos(tx: DataStoreTx, matterId: string, ids: string[]) {
  const rows = ids.length
    ? await tx.invoices.findMany({
        where: { id: { in: ids }, matterId, invoiceType: "ACCONTO", deductedOnFinals: { none: {} } },
      })
    : [];
  if (rows.length !== ids.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Några acconto-fakturor är redan avdragna eller tillhör annat ärende." });
  }
  return rows;
}

/**
 * Koppla poster till fakturan + skapa acconto-avdrag via explicita anrop
 * (ej Prisma nested writes) så samma kod kör mot både Postgres och git-store:n.
 */
async function linkBilledItems(
  tx: DataStoreTx,
  invoiceId: InvoiceId,
  timeEntries: ReadonlyArray<{ id: TimeEntryId }>,
  expenses: ReadonlyArray<{ id: ExpenseId }>,
  accontos: ReadonlyArray<{ id: InvoiceId }>,
): Promise<void> {
  if (timeEntries.length) {
    await tx.timeEntries.updateMany({ where: { id: { in: timeEntries.map((t) => t.id) } }, data: { invoiceId } });
  }
  if (expenses.length) {
    await tx.expenses.updateMany({ where: { id: { in: expenses.map((e) => e.id) } }, data: { invoiceId } });
  }
  for (const a of accontos) {
    await tx.accontoDeductions.create({ data: { finalInvoiceId: invoiceId, accontoInvoiceId: a.id } });
  }
}

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

/** Summera fakturans avräkningshinkar (betalt/krediterat/avskrivet) → ledger. */
async function gatherInvoiceLedger(
  tx: DataStoreTx,
  orgId: string,
  inv: { id: string; amount: number; payments?: ReadonlyArray<{ amount: number }> },
): Promise<{ paid: number; credited: number; writtenOff: number; ledger: ReturnType<typeof computeInvoiceLedger> }> {
  const paid = (inv.payments ?? []).reduce((s, p) => s + p.amount, 0);
  const credits = await tx.invoices.findMany({ where: { creditedInvoiceId: inv.id, matter: { organizationId: orgId } } });
  const credited = ((credits ?? []) as ReadonlyArray<{ amount: number }>).reduce((s, c) => s + Math.abs(c.amount), 0);
  const existing = await tx.writeOffs.findMany({ where: { invoiceId: inv.id } });
  const writtenOff = ((existing ?? []) as ReadonlyArray<{ amount: number }>).reduce((s, w) => s + w.amount, 0);
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

/** Nästa lediga fakturanummer (F-YYYY-NNNN) för org:en. Speglar nextMatterNumber. */
async function nextInvoiceNumber(
  invoices: { findFirst: (args: unknown) => Promise<unknown> },
  orgId: string,
): Promise<string> {
  const prefix = `F-${new Date().getFullYear()}-`;
  const last = (await invoices.findFirst({
    where: { matter: { organizationId: orgId }, invoiceNumber: { startsWith: prefix } },
    orderBy: { invoiceNumber: "desc" },
  })) as { invoiceNumber?: string | null } | null;
  const seq = last?.invoiceNumber ? parseInt(last.invoiceNumber.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${seq.toString().padStart(4, "0")}`;
}

const invoiceTypeSchema = z.enum(["STANDARD", "ACCONTO", "FINAL"]);
const invoiceStatusSchema = z.enum([
  "DRAFT",
  "SENT",
  "PAID",
  "CANCELLED",
  "BAD_DEBT",
  "INSTALLMENT_PLAN",
]);

export const invoiceRouter = router({
  list: orgProcedure
    .input(
      z.object({
        matterId: z.string().optional(),
        invoiceType: invoiceTypeSchema.optional(),
        status: invoiceStatusSchema.optional(),
      }),
    )
    .query(({ ctx, input }) =>
      ctx.dataStore.invoices.findMany({
        where: {
          matter: { organizationId: ctx.orgId },
          ...(input.matterId ? { matterId: input.matterId } : {}),
          ...(input.invoiceType ? { invoiceType: input.invoiceType } : {}),
          ...(input.status ? { status: input.status } : {}),
        },
        orderBy: { invoiceDate: "desc" },
        include: {
          matter: { select: { id: true, matterNumber: true, title: true } },
          paymentPlan: true,
          payments: { orderBy: { paidAt: "desc" } },
          accontoDeductions: { include: { accontoInvoice: true } },
          deductedOnFinals: { select: { id: true } },
          creditedInvoice: { select: { id: true, invoiceDate: true, amount: true } },
          creditNote: { select: { id: true, invoiceDate: true, amount: true } },
        },
      }),
    ),

  getById: orgProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      // Migrerad till repository-sömmen (ADR 0020). getByIdFull org-scopar +
      // hämtar hela detalj-shapen (relations + aconto-avdrag/kredit).
      const inv = await ctx.repos.invoices.getByIdFull(input.id, ctx.orgId);
      if (!inv) throw new TRPCError({ code: "NOT_FOUND" });
      return inv;
    }),

  /** ACCONTO: advokaten anger belopp. Inga time entries/expenses kopplas. */
  createAcconto: orgProcedure
    .input(
      z.object({
        /** Valfritt klient-genererat id (demo-generator/fixtures) → annars genererar store:n. */
        id: invoiceIdSchema.optional(),
        matterId: matterIdSchema,
        amount: z.number().int().min(1),
        invoiceDate: z.string().optional(),
        dueDate: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const matter = await ctx.dataStore.matters.findFirst({
        where: { id: input.matterId, organizationId: ctx.orgId },
      });
      if (!matter) throw new TRPCError({ code: "NOT_FOUND" });
      const accontoNumber = await nextInvoiceNumber(ctx.dataStore.invoices, ctx.orgId);
      const invoice = await ctx.dataStore.invoices.create({
        data: omitUndefined({
          id: input.id, // undefined → store genererar
          matterId: input.matterId,
          invoiceNumber: accontoNumber,
          // Kundfaktura → Bankgiro-OCR (#182). Kostnadsräkningar (billingRun-
          // flödet) och CREDIT får ingen OCR — betalas inte med OCR.
          ocrReference: ocrFromInvoiceNumber(accontoNumber),
          amount: input.amount,
          invoiceType: "ACCONTO",
          status: "DRAFT",
          invoiceDate: input.invoiceDate ? new Date(input.invoiceDate) : new Date(),
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          notes: input.notes,
        }),
      });
      await emit.invoiceCreated(ctx, invoice);
      return invoice;
    }),

  /**
   * RÅDGIVNING (#383, rättshjälp del A): registrera klientens betalda
   * rådgivningstimme (1 tim enligt rättshjälpstaxan) som en SEPARAT klient-
   * faktura (STANDARD mot KLIENT) + märk ärendet (`radgivningBetaldAt`) så
   * domstolens kostnadsräkning visar text-raden. Timmen ingår ALDRIG i
   * domstolens kostnadsräkning som debiterbar post. Idempotent: avvisar om
   * redan registrerad.
   */
  createRadgivning: orgProcedure
    .input(z.object({ matterId: matterIdSchema, hasFTax: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.dataStore.transaction(async (tx) => {
        const matter = await tx.matters.findFirst({
          where: { id: input.matterId, organizationId: ctx.orgId },
        });
        if (!matter) throw new TRPCError({ code: "NOT_FOUND" });
        if ((matter as { radgivningBetaldAt?: unknown }).radgivningBetaldAt) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Rådgivningstimmen är redan registrerad för detta ärende." });
        }
        const avgift = computeRadgivningsavgift({ ...omitUndefined({ hasFTax: input.hasFTax }) });
        const invoiceNumber = await nextInvoiceNumber(tx.invoices, ctx.orgId);
        const invoice = await tx.invoices.create({
          data: {
            matterId: input.matterId,
            invoiceNumber,
            ocrReference: ocrFromInvoiceNumber(invoiceNumber),
            amount: avgift.beloppExclVatOre,
            invoiceType: "STANDARD",
            status: "DRAFT",
            invoiceDate: new Date(),
            dueDate: null,
            notes: "Rådgivningstimme enligt rättshjälpstaxan (1 tim).",
          },
        });
        await tx.matters.update({ where: { id: input.matterId }, data: { radgivningBetaldAt: new Date() } });
        await emit.invoiceCreated(ctx, invoice);
        return { invoice, beloppExclVatOre: avgift.beloppExclVatOre };
      });
    }),

  /**
   * FINAL: summerar valda time entries + expenses, drar av valda acconto-
   * fakturor. Allt går i en transaktion så time entries/expenses inte
   * "flaggas som fakturerade" halvvägs om något kraschar.
   */
  createFinal: orgProcedure
    .input(
      z.object({
        /** Valfritt klient-genererat id (demo-generator/fixtures) → annars genererar store:n. */
        id: invoiceIdSchema.optional(),
        matterId: matterIdSchema,
        timeEntryIds: z.array(z.string()),
        expenseIds: z.array(z.string()),
        accontoInvoiceIds: z.array(z.string()).default([]),
        invoiceDate: z.string().optional(),
        dueDate: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.dataStore.transaction(async (tx) => {
        const matter = await tx.matters.findFirst({
          where: { id: input.matterId, organizationId: ctx.orgId },
        });
        if (!matter) throw new TRPCError({ code: "NOT_FOUND" });

        const timeEntries = await fetchUnbilledTimeEntries(tx, input.matterId, input.timeEntryIds);
        const expenses = await fetchUnbilledExpenses(tx, input.matterId, input.expenseIds);
        const accontos = await fetchDeductibleAccontos(tx, input.matterId, input.accontoInvoiceIds);

        const breakdown = computeFinalInvoiceBreakdown(
          timeEntries.map((t) => ({ minutes: t.minutes, hourlyRate: t.user.hourlyRate ?? 0 })),
          expenses.map((e) => ({ amount: e.amount, billable: e.billable })),
          accontos.map((a) => ({ id: a.id, amount: a.amount })),
        );

        const finalNumber = await nextInvoiceNumber(tx.invoices, ctx.orgId);
        const invoice = await tx.invoices.create({
          data: omitUndefined({
            id: input.id, // undefined → store genererar
            matterId: input.matterId,
            invoiceNumber: finalNumber,
            ocrReference: ocrFromInvoiceNumber(finalNumber), // kundfaktura → OCR (#182)
            amount: breakdown.grossAmount,
            invoiceType: "FINAL",
            status: "DRAFT",
            invoiceDate: input.invoiceDate ? new Date(input.invoiceDate) : new Date(),
            dueDate: input.dueDate ? new Date(input.dueDate) : null,
            notes: input.notes,
          }),
        });

        await linkBilledItems(tx, invoice.id, timeEntries, expenses, accontos);
        return { invoice, breakdown };
      }).then(async (result) => {
        await emit.invoiceCreated(ctx, result.invoice);
        return result;
      });
    }),

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
    .mutation(async ({ ctx, input }) => {
      return ctx.dataStore.transaction(async (tx) => {
        const original = await tx.invoices.findFirst({
          where: { id: input.invoiceId, matter: { organizationId: ctx.orgId } },
          include: { creditNote: true, paymentPlan: true },
        });
        if (!original) throw new TRPCError({ code: "NOT_FOUND" });
        if (original.invoiceType === "CREDIT") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Kan inte kreditera en kreditfaktura.",
          });
        }
        if (original.creditNote) {
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
        if (original.paymentPlan && original.paymentPlan.status === "ACTIVE") {
          await tx.paymentPlans.update({
            where: { id: original.paymentPlan.id },
            data: { status: "CANCELLED" },
          });
        }

        const credit = await tx.invoices.create({
          data: {
            ...omitUndefined({ id: input.id, notes: input.notes }), // undefined → store genererar
            matterId: original.matterId,
            invoiceNumber: await nextInvoiceNumber(tx.invoices, ctx.orgId),
            amount: -original.amount,
            invoiceType: "CREDIT",
            status: "SENT", // kreditfaktura är "färdig" direkt
            invoiceDate: new Date(),
            creditedInvoiceId: original.id,
          },
        });

        await tx.invoices.update({
          where: { id: original.id },
          data: { status: "CANCELLED" },
        });

        return credit;
      });
    }),

  recordPayment: orgProcedure
    .input(
      z.object({
        invoiceId: z.string(),
        amount: z.number().int().min(1),
        paidAt: z.string(),
        note: z.string().optional(),
        /** Extern betalningsreferens (camt-import #181) — för idempotent re-import. */
        reference: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.dataStore.transaction(async (tx) => {
        const inv = await tx.invoices.findFirst({
          where: { id: input.invoiceId, matter: { organizationId: ctx.orgId } },
          include: { paymentPlan: true, payments: true },
        });
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
          await tx.invoices.update({ where: { id: inv.id }, data: { status: "SENT" } });
        }

        // Konsistens-skydd (ADR 0007): en betalning får inte översumera fakturan
        // (betalt + krediterat + avskrivet > belopp → utestående < 0). Validera
        // FÖRE skapandet så vi inte lämnar en partition-brytande rad.
        const { paid, credited, writtenOff } = await gatherInvoiceLedger(tx, ctx.orgId, inv);
        const afterLedger = computeInvoiceLedger(inv.amount, paid + input.amount, credited, writtenOff);
        const violation = invoicePartitionViolation(inv.amount, afterLedger);
        if (violation) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Betalningen kan inte registreras: ${violation}` });
        }

        const payment = await tx.payments.create({
          data: {
            invoiceId: inv.id,
            amount: input.amount,
            paidAt: new Date(input.paidAt),
            note: input.note,
            reference: input.reference,
            recordedById: asId<"UserId">(ctx.user.id),
          },
        });

        const paidSum =
          inv.payments.reduce((s: number, p: { amount: number }) => s + p.amount, 0) + input.amount;

        if (isPaymentPlanSettled(inv.amount, paidSum)) {
          await tx.invoices.update({
            where: { id: inv.id },
            data: { status: "PAID" },
          });
          if (inv.paymentPlan) {
            await tx.paymentPlans.update({
              where: { id: inv.paymentPlan.id },
              data: { status: "COMPLETED" },
            });
          }
        }
        return { payment, paidSum, settled: isPaymentPlanSettled(inv.amount, paidSum) };
      });
    }),

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
    .mutation(async ({ ctx, input }) => {
      return ctx.dataStore.transaction(async (tx) => {
        const inv = await tx.invoices.findFirst({
          where: { id: input.invoiceId, matter: { organizationId: ctx.orgId } },
          include: { paymentPlan: true },
        });
        if (!inv) throw new TRPCError({ code: "NOT_FOUND" });
        if (inv.paymentPlan && inv.paymentPlan.status === "ACTIVE") {
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
        if (inv.paymentPlan && inv.paymentPlan.status !== "ACTIVE") {
          await tx.paymentPlans.delete({ where: { id: inv.paymentPlan.id } });
        }

        const plan = await tx.paymentPlans.create({
          data: {
            ...omitUndefined({ id: input.id, notes: input.notes }), // undefined → store genererar
            invoiceId: inv.id,
            monthlyAmount: input.monthlyAmount,
            dayOfMonth: input.dayOfMonth,
            startDate: new Date(input.startDate),
            // Explicit (Prisma schema-default appliceras inte av in-memory-store:n).
            status: "ACTIVE",
          },
        });
        await tx.invoices.update({
          where: { id: inv.id },
          data: { status: "INSTALLMENT_PLAN" },
        });
        return plan;
      });
    }),

  cancelPaymentPlan: orgProcedure
    .input(z.object({ planId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.dataStore.transaction(async (tx) => {
        const plan = await tx.paymentPlans.findFirst({
          where: {
            id: input.planId,
            invoice: { matter: { organizationId: ctx.orgId } },
          },
        });
        if (!plan) throw new TRPCError({ code: "NOT_FOUND" });
        await tx.paymentPlans.update({
          where: { id: plan.id },
          data: { status: "CANCELLED" },
        });
        await tx.invoices.update({
          where: { id: plan.invoiceId },
          data: { status: "SENT" },
        });
        return { ok: true };
      });
    }),

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
        invoiceId: z.string(),
        amount: z.number().int().min(1).optional(),
        reason: z.string().optional(),
        writtenOffAt: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.dataStore.transaction(async (tx) => {
        const inv = ensureWritableOff(
          await tx.invoices.findFirst({
            where: { id: input.invoiceId, matter: { organizationId: ctx.orgId } },
            include: { payments: true },
          }),
        );

        const { paid, credited, writtenOff, ledger } = await gatherInvoiceLedger(tx, ctx.orgId, inv);
        const amount = resolveWriteOffAmount(ledger.outstanding, input.amount);

        const writeOff = await tx.writeOffs.create({
          data: {
            invoiceId: inv.id,
            amount,
            writtenOffAt: input.writtenOffAt ? new Date(input.writtenOffAt) : new Date(),
            ...omitUndefined({ reason: input.reason }),
            recordedById: asId<"UserId">(ctx.user.id),
          },
        });

        // Härled status efter avskrivningen och persistera om återstoden stängdes.
        const after = computeInvoiceLedger(inv.amount, paid, credited, writtenOff + amount);
        const derived = deriveInvoiceStatus(inv.status as InvoiceStatus, after);
        if (derived !== inv.status) {
          await tx.invoices.update({ where: { id: inv.id }, data: { status: derived } });
        }

        await emit.invoiceWrittenOff(ctx, inv.id, inv.matterId, amount);
        return { writeOff, outstanding: after.outstanding, status: derived };
      });
    }),

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
        invoiceId: z.string(),
        status: z.enum(["SENT", "CANCELLED", "BAD_DEBT"]),
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
