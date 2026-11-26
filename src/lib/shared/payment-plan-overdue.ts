/**
 * När en avbetalningsplan ligger efter (#2136) — EN regel för Avbetalningar och,
 * senare, Att åtgärda.
 *
 * AVA skickar inga påminnelser till klienten (#2135); juristen ser i stället
 * att klienten ligger efter och tar kontakt själv. Härlett, inget lagras: när
 * klienten betalat ikapp, eller planen inte längre är aktiv, försvinner
 * markeringen av sig själv. Förebild: `invoice-overdue.ts` (ren regel,
 * strukturell indata, svensk kalenderdag).
 */

import { Temporal } from "@js-temporal/polyfill";
import { stockholmDay } from "./stockholm-time";
import { daysBetween } from "./watchlist";

/** Planens fält som regeln läser. Datum kan vara Date eller ISO-sträng. */
export interface PlanOverdueInput {
  status: string;
  /** Öre per månad. */
  monthlyAmount: number;
  /** Förfallodag i månaden (1–28). */
  dayOfMonth: number;
  startDate: Date | string;
  invoice?: {
    amount?: number | null | undefined;
    payments?: readonly { amount: number }[] | null | undefined;
    writeOffs?: readonly { amount: number }[] | null | undefined;
  } | null | undefined;
}

/** En plan som ligger efter: sedan när, hur länge och med hur mycket. */
export interface PlanOverdue {
  /** Förfallodagen för den äldsta obetalda delbetalningen ("YYYY-MM-DD", svensk dag). */
  dueDate: string;
  /** Hela svenska kalenderdagar sedan `dueDate`. */
  overdueDays: number;
  /** Öre som klienten ligger efter planen. */
  behindOre: number;
}

const sum = (rows: readonly { amount: number }[] | null | undefined): number =>
  (rows ?? []).reduce((s, r) => s + r.amount, 0);

/** Svensk kalenderdag för en tidpunkt. */
function plainDay(d: Date | string): Temporal.PlainDate {
  return Temporal.PlainDate.from(stockholmDay(new Date(d)));
}

/** Den första förfallodagen: planens dag i månaden, på eller efter startdatumet. */
function firstDueDate(startDate: Date | string, dayOfMonth: number): Temporal.PlainDate {
  const start = plainDay(startDate);
  const sameMonth = start.with({ day: dayOfMonth });
  return Temporal.PlainDate.compare(sameMonth, start) >= 0 ? sameMonth : sameMonth.add({ months: 1 });
}

/** Antal delbetalningar vars förfallodag ligger före `today` (förfallodagen i dag är inte förfallen). */
function dueInstallments(first: Temporal.PlainDate, today: Temporal.PlainDate): number {
  if (Temporal.PlainDate.compare(first, today) >= 0) return 0;
  const months = (today.year - first.year) * 12 + (today.month - first.month);
  const dueThisMonth = first.add({ months });
  return Temporal.PlainDate.compare(dueThisMonth, today) < 0 ? months + 1 : months;
}

/**
 * Om planen ligger efter vid `now`, eller `null`. Gäller bara aktiva planer med
 * en faktura med belopp. Att ha betalat hittills är de förfallna delbetalningarna
 * (högst fakturans belopp); betalt är betalningarna plus avskrivet (ADR 0007),
 * räknat mot de äldsta delbetalningarna först.
 */
export function paymentPlanOverdue(plan: PlanOverdueInput, now: Date): PlanOverdue | null {
  const amount = plan.invoice?.amount ?? 0;
  if (plan.status !== "ACTIVE" || amount <= 0) return null;
  const first = firstDueDate(plan.startDate, plan.dayOfMonth);
  const expected = Math.min(dueInstallments(first, plainDay(now)) * plan.monthlyAmount, amount);
  const paid = sum(plan.invoice?.payments) + sum(plan.invoice?.writeOffs);
  if (expected <= paid) return null;
  const dueDate = first.add({ months: Math.floor(paid / plan.monthlyAmount) }).toString();
  return { dueDate, overdueDays: daysBetween(new Date(dueDate), now), behindOre: expected - paid };
}
