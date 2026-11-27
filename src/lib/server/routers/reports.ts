import { z } from "zod";
import { userIdSchema } from "@/lib/shared/schemas/ids";
import { loadArReport } from "../reports/ar-report";
import { loadBilledReport } from "../reports/billed-report";
import { loadFirmOverview } from "../reports/firm-overview";
import { loadLawyerReport } from "../reports/lawyer-report";
import { router, protectedProcedure } from "../trpc";

/**
 * Advokat-fokuserade rapporter: användaren väljer period (from/to) och
 * en advokat. Routern validerar indata och anropar rapporttjänsterna i
 * `src/lib/server/reports/` (#2176) med byrån ur sessionen.
 *
 * Enheter (samma som resten av kodbasen):
 *   - `TimeEntry.minutes`    — heltal minuter
 *   - `TimeEntry.hourlyRate` — öre/timme (seed-data: 250_000 = 2 500 kr/h)
 *   - `Expense.amount`       — öre
 *   - `Invoice.amount`       — öre
 *
 * Alla kronbelopp som returneras är i **öre** så UI kan använda
 * `formatKr()` rakt av.
 */

/** Period (svenska kalenderdagar) och en advokat. */
const lawyerPeriodInput = z.object({
  from: z.string(),
  to: z.string(),
  userId: userIdSchema,
});

export const reportsRouter = router({
  /**
   * Advokatrapport: en advokat, en period, tre delrapporter.
   *   1. Ärenden advokaten jobbat i under perioden
   *   2. Timdebitering per vecka
   *   3. Upparbetat, icke fakturerat (time entries & billable expenses
   *      utan invoiceId för den advokaten inom perioden)
   */
  perLawyer: protectedProcedure
    .input(lawyerPeriodInput)
    .query(({ ctx, input }) => loadLawyerReport(ctx.repos, ctx.user.organizationId, input)),

  /**
   * "Fakturerat per advokat och period" (#90). För vald advokat + period:
   * fakturor som gått ut (attribuerade proportionellt mot advokatens andel
   * av frozen arbetsvärde i fakturan), deras summa, och netto efter avdrag
   * för fakturor avskrivna i FÖREGÅENDE kalendermånad.
   */
  billed: protectedProcedure
    .input(lawyerPeriodInput)
    .query(({ ctx, input }) => loadBilledReport(ctx.repos, ctx.user.organizationId, input)),

  /**
   * Byråöversikt (#1016): en rad per jurist + byråtotaler + fordringsläge,
   * i ETT anrop. Finns för AI-ytan — utan den kostar "hur går det för byrån,
   * per person?" 2N+1 verktygsanrop (user.list + perLawyer×N + billed×N) där
   * varje perLawyer-svar dessutom drar veckotabeller översikten inte behöver.
   * Komponerad ur samma rena delrapporter som perLawyer/billed; org-datat
   * hämtas en gång och delas mellan raderna.
   */
  firmOverview: protectedProcedure
    .input(z.object({ from: z.string(), to: z.string() }))
    .query(({ ctx, input }) => loadFirmOverview(ctx.repos, ctx.user.organizationId, input)),

  /**
   * Kundfordrings-sammanställning (ADR 0007), LIVSTID: brygga + åldersanalys.
   * Bygger på WriteOff-posterna (#136–139) → konstaterad kundförlust är en
   * daterad sanning, inte en härledd updatedAt-gissning. Med `userId`
   * attribueras fordringarna mot advokatens andel av det frysta arbetet.
   */
  arSummary: protectedProcedure
    .input(z.object({ from: z.string(), to: z.string(), userId: userIdSchema.optional() }))
    .query(({ ctx, input }) => loadArReport(ctx.repos, ctx.user.organizationId, input)),
});
