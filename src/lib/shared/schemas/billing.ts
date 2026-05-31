import { z } from "zod";
import { baseFields, dateLike, optionalDateLike } from "./common";
import {
  billingRunRecipientSchema,
  billingRunStatusSchema,
  billingRunTypeSchema,
  expenseKindSchema,
  invoiceStatusSchema,
  invoiceTypeSchema,
  paymentPlanStatusSchema,
  reminderTypeSchema,
} from "./enums";

/**
 * TimeEntry — tidsregistrering på ärende. Lagras i `time-entries/<id>.json`.
 * `minutes` är heltal; `hourlyRate` är öre per timme.
 */
export const timeEntrySchema = z.object({
  ...baseFields,
  userId: z.string(),
  matterId: z.string(),
  date: dateLike,
  minutes: z.number().int().nonnegative(),
  description: z.string(),
  /** öre per timme — snapshotad vid registrering så historik inte påverkas av taxan-byten. */
  hourlyRate: z.number().int().nonnegative(),
  billable: z.boolean().default(true),
  /** @deprecated Använd `frozenByBillingRunId`. invoiceId behålls för
   *  bakåt­kompatibilitet med befintlig demo/billing — nya flöden ska
   *  använda BillingRun-modellen. */
  invoiceId: z.string().nullish(),
  /** När raden frystes som del av en slutfaktura. Null = upparbetad och
   *  fortfarande redigerbar. Aconto fryser INTE — bara FINAL +
   *  KOSTNADSRAKNING. */
  frozenAt: optionalDateLike,
  /** Vilken BillingRun frös raden. */
  frozenByBillingRunId: z.string().nullish(),
}).passthrough();

export type TimeEntry = z.infer<typeof timeEntrySchema>;

/**
 * Expense (Utlägg) — `amount` i öre. Lagras i `expenses/<id>.json`.
 *
 * Moms-modellen:
 *   - `amount` är beloppet som står på kvittot (i öre)
 *   - `vatRate` i basis points: 0/600/1200/2500 (= 0/6/12/25 %)
 *   - `vatIncluded=true` → `amount` inkluderar redan moms (vanligaste fallet)
 *   - `vatIncluded=false` → `amount` är exkl moms, moms läggs ovanpå
 *
 * `splitVat({amount, vatRate, vatIncluded})` returnerar `{exclVat, vat, inclVat}`
 * deterministiskt. Se `src/shared/vat.ts`.
 *
 * Backwards-compat: gamla rader utan vatRate/vatIncluded ska tolkas som
 * 25 % inkl moms (default-fallet för svenska kvitton). zod-defaults gör jobbet.
 */
export const expenseSchema = z.object({
  ...baseFields,
  userId: z.string(),
  matterId: z.string(),
  date: dateLike,
  amount: z.number().int(),
  description: z.string(),
  billable: z.boolean().default(true),
  /** @deprecated Se motsvarande not på timeEntry.invoiceId. */
  invoiceId: z.string().nullish(),
  /** Moms-sats i basis points (0/600/1200/2500). Default 25 %. */
  vatRate: z.number().int().nonnegative().max(10000).default(2500),
  /** Är `amount` redan inkl moms? Default true (kvitto-fall). */
  vatIncluded: z.boolean().default(true),
  /** Skiljer vanligt utlägg (EXPENSE) från PRUTNING (domstols-justering).
   *  PRUTNING har negativt amount, vatRate=0, vatIncluded=false. Default
   *  EXPENSE för bakåtkompatibilitet med befintliga rader. */
  kind: expenseKindSchema.default("EXPENSE"),
  /** Samma frozen-mekanism som timeEntry. */
  frozenAt: optionalDateLike,
  frozenByBillingRunId: z.string().nullish(),
}).passthrough();

export type Expense = z.infer<typeof expenseSchema>;

/**
 * Invoice — `amount` i öre (brutto för FINAL, negativt för CREDIT).
 * Lagras i `invoices/<id>.json`.
 */
export const invoiceSchema = z.object({
  ...baseFields,
  matterId: z.string(),
  amount: z.number().int(),
  status: invoiceStatusSchema.default("DRAFT"),
  invoiceType: invoiceTypeSchema.default("STANDARD"),
  fortnoxId: z.string().nullish(),
  invoiceDate: dateLike,
  dueDate: optionalDateLike,
  notes: z.string().nullish(),
  /** Bara satt på CREDIT-fakturor — pekar på den ursprungliga fakturan som krediteras. */
  creditedInvoiceId: z.string().nullish(),
}).passthrough();

export type Invoice = z.infer<typeof invoiceSchema>;

/**
 * Payment — registrerad inbetalning mot en faktura. `amount` i öre.
 * Lagras i `payments/<id>.json`.
 */
export const paymentSchema = z.object({
  id: z.string(),
  invoiceId: z.string(),
  amount: z.number().int(),
  paidAt: dateLike,
  note: z.string().nullish(),
  recordedById: z.string(),
  createdAt: dateLike,
}).passthrough();

export type Payment = z.infer<typeof paymentSchema>;

/**
 * PaymentPlan — avbetalningsplan kopplad 1:1 till en Invoice. När den är
 * ACTIVE sätter vi Invoice.status = INSTALLMENT_PLAN. Lagras i
 * `payment-plans/<id>.json`.
 */
export const paymentPlanSchema = z.object({
  ...baseFields,
  invoiceId: z.string(),
  /** öre/månad */
  monthlyAmount: z.number().int().positive(),
  /** 1-28 */
  dayOfMonth: z.number().int().min(1).max(28),
  startDate: dateLike,
  status: paymentPlanStatusSchema.default("ACTIVE"),
  notes: z.string().nullish(),
}).passthrough();

export type PaymentPlan = z.infer<typeof paymentPlanSchema>;

/**
 * PaymentPlanReminder — idempotens-record för månads-mailutskick. En rad per
 * (plan, månad, type). Skickas av cron-jobbet (eller en kommande GH Actions-
 * jobb i ren git-modell).
 */
export const paymentPlanReminderSchema = z.object({
  id: z.string(),
  planId: z.string(),
  /** "YYYY-MM" */
  dueMonth: z.string().regex(/^\d{4}-\d{2}$/),
  type: reminderTypeSchema,
  sentAt: dateLike,
}).passthrough();

export type PaymentPlanReminder = z.infer<typeof paymentPlanReminderSchema>;

/**
 * AccontoDeduction — länk FINAL ← ACCONTO. Lagras i `acconto-deductions/<id>.json`.
 */
export const accontoDeductionSchema = z.object({
  id: z.string(),
  finalInvoiceId: z.string(),
  accontoInvoiceId: z.string(),
}).passthrough();

export type AccontoDeduction = z.infer<typeof accontoDeductionSchema>;

/**
 * BillingRun — *händelsen* att fakturera (eller förbereda fakturering).
 * En BillingRun grupperar en uppsättning tids- och utläggsrader och
 * resulterar i (eller pekar mot) en Invoice. Modellen hanterar:
 *
 *   ACCONTO    — del-faktura till klient på X% av upparbetat värde.
 *                Fryser INTE underliggande rader. Skapar Invoice direkt.
 *   FINAL      — slutfaktura med full specifikation + avdrag för tidigare
 *                ACCONTO-runs. Fryser raderna. Skapar Invoice direkt.
 *   KOSTNADSRAKNING — OFFENTLIG_FÖRSVARARE-flow. Skickas till domstol
 *                INNAN dom. Status = PENDING_VERDICT tills advokaten
 *                anger om kostnadsräkningen prutats. Invoice skapas
 *                först efter PENDING_VERDICT → SENT.
 *   CREDIT     — kreditering av en tidigare BillingRun.
 *
 * Bevarar audit-trail: snapshot av workValueOre + clientShareBips vid
 * körning så historiska beräkningar inte påverkas av matter-ändringar.
 *
 * Lagras i `billing-runs/<id>.json`.
 */
export const billingRunSchema = z.object({
  ...baseFields,
  matterId: z.string(),
  type: billingRunTypeSchema,
  recipient: billingRunRecipientSchema,
  status: billingRunStatusSchema.default("DRAFT"),
  /** Snapshot: totalt upparbetat värde (öre) vid run-tidpunkten. */
  workValueOreAtRun: z.number().int().nonnegative(),
  /** Snapshot: klientens andel i basis points (rättsskydd/hjälp).
   *  Null för OFFENTLIG_FÖRSVARARE + PRIVAT. */
  clientShareBips: z.number().int().min(0).max(10000).nullish(),
  /** För ACCONTO: föreslaget belopp (workValue × clientShare). Advokat
   *  kan justera. För FINAL: hela beloppet före aconto-avdrag. */
  proposedAmountOre: z.number().int(),
  /** Faktiskt skickat belopp (kan avvika från proposed efter justering). */
  amountOre: z.number().int(),
  /** För KOSTNADSRAKNING: advokatens prutning-belopp (negativt). Sätts
   *  när dom kommit. Driver Expense(kind=PRUTNING) som skapas vid SENT. */
  prutningOre: z.number().int().nullish(),
  /** Resulterande Invoice — null tills status=SENT. */
  invoiceId: z.string().nullish(),
  /** För FINAL: lista av ACCONTO-runs som dras av. */
  deductedBillingRunIds: z.array(z.string()).default([]),
  periodFrom: optionalDateLike,
  periodTo: optionalDateLike,
  /** Fri text — t.ex. "Inkluderar tidsspillan resa Stockholm-Göteborg". */
  notes: z.string().nullish(),
}).passthrough();

export type BillingRun = z.infer<typeof billingRunSchema>;
