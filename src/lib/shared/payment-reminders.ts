/**
 * Payment-scan — ren kärna för avbetalningsplaners påminnelse-generering (#23).
 *
 * Givet aktiva planer + dagens datum + redan loggade påminnelser → besluta
 * vilka `payment.due`/`payment.overdue`-händelser som ska emittas (och loggas
 * via `paymentPlan.recordReminder`). Ren funktion → trivialt testbar; all
 * I/O (hämta planer, emit, logga) sker i `paymentPlan.scanDueReminders`.
 *
 * Semantik (beslutad i #23):
 *   - **remaining** = `invoiceTotalOre − paidOre`. `remaining ≤ 0` → planen är
 *     i praktiken betald → ingen påminnelse.
 *   - **DUE**: innevarande månads installment. Skickas när `today ≥ dayOfMonth`
 *     och ingen DUE redan loggats för (plan, innevarande YYYY-MM).
 *   - **OVERDUE**: föregående månad (vars förfallodag passerat) med
 *     `remaining > 0` och ingen OVERDUE redan loggad för den månaden. Endast
 *     föregående månad eskaleras — ingen backfill av äldre månader (undviker
 *     spam-flod vid första scan).
 *   - **Företräde**: OVERDUE går före DUE — är klienten redan efter skickar vi
 *     inte också en vänlig DUE samma scan. Max EN påminnelse per plan/scan.
 *   - Idempotens: `(planId, dueMonth, type)` mot påminnelse-loggen.
 *
 * Per-installment-"betalt" spåras inte (betalningar bokförs mot fakturan, inte
 * per månad) → `remaining > 0` är grinden, enligt produktbeslut i #23.
 */

export type ReminderKind = "DUE" | "OVERDUE";

/** En aktiv plan med allt kärnan behöver för beslut + payload. */
export interface PlanForScan {
  planId: string;
  status: string;
  monthlyAmount: number; // öre/månad
  dayOfMonth: number; // 1–28
  startDate: Date;
  invoiceTotalOre: number; // fakturans totalbelopp
  paidOre: number; // summa registrerade betalningar
  matterId: string;
  matterNumber: string;
  matterTitle: string;
  recipientEmail: string;
  recipientName: string;
}

/** Redan loggad påminnelse (idempotens-nyckel). */
export interface LoggedReminder {
  planId: string;
  dueMonth: string; // "YYYY-MM"
  type: ReminderKind;
}

/** En påminnelse som ska skickas: loggas + emittas av anroparen. */
export interface PlannedReminder {
  planId: string;
  matterId: string;
  dueMonth: string; // "YYYY-MM"
  type: ReminderKind;
  eventType: "payment.due" | "payment.overdue";
  idempotencyKey: string;
  remainingOre: number;
  /** Payload-kontraktet som starter-rules 1b/1c läser. */
  payload: Record<string, unknown>;
}

function monthKey(year: number, monthIndex0: number): string {
  return `${year}-${String(monthIndex0 + 1).padStart(2, "0")}`;
}

function plannedFor(plan: PlanForScan, dueMonth: string, type: ReminderKind, remainingOre: number): PlannedReminder {
  const eventType = type === "DUE" ? "payment.due" : "payment.overdue";
  return {
    planId: plan.planId,
    matterId: plan.matterId,
    dueMonth,
    type,
    eventType,
    idempotencyKey: `${eventType}:${plan.planId}:${dueMonth}`,
    remainingOre,
    payload: {
      planId: plan.planId,
      dueMonth,
      recipientEmail: plan.recipientEmail,
      recipientName: plan.recipientName,
      matterNumber: plan.matterNumber,
      matterTitle: plan.matterTitle,
      invoiceAmount: plan.invoiceTotalOre,
      monthlyAmount: plan.monthlyAmount,
      dayOfMonth: plan.dayOfMonth,
      remainingAmount: remainingOre,
      idempotencyKey: `${eventType}:${plan.planId}:${dueMonth}`,
    },
  };
}

/**
 * Beslut för EN plan: OVERDUE (föregående månad) före DUE (innevarande). Null
 * om inget ska skickas.
 */
function decideForPlan(plan: PlanForScan, now: Date, logged: Set<string>): PlannedReminder | null {
  const remaining = plan.invoiceTotalOre - plan.paidOre;
  if (plan.status !== "ACTIVE" || remaining <= 0) return null;

  const startIdx = plan.startDate.getUTCFullYear() * 12 + plan.startDate.getUTCMonth();
  const curIdx = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const curMonth = monthKey(now.getUTCFullYear(), now.getUTCMonth());

  // OVERDUE: föregående månad (om planen fanns då) — eskalera obetald.
  const prevIdx = curIdx - 1;
  if (prevIdx >= startIdx) {
    const prevMonth = monthKey(Math.floor(prevIdx / 12), prevIdx % 12);
    if (!logged.has(`${plan.planId}:${prevMonth}:OVERDUE`)) {
      return plannedFor(plan, prevMonth, "OVERDUE", remaining);
    }
  }

  // DUE: innevarande månad när förfallodagen passerat.
  if (curIdx >= startIdx && now.getUTCDate() >= plan.dayOfMonth
      && !logged.has(`${plan.planId}:${curMonth}:DUE`)) {
    return plannedFor(plan, curMonth, "DUE", remaining);
  }
  return null;
}

/**
 * Scanna planer och returnera påminnelser att skicka (max en per plan). Ren
 * funktion: anroparen loggar + emittar resultatet.
 */
export function computeDueReminders(
  plans: readonly PlanForScan[],
  now: Date,
  logged: readonly LoggedReminder[],
): PlannedReminder[] {
  const loggedSet = new Set(logged.map((r) => `${r.planId}:${r.dueMonth}:${r.type}`));
  const out: PlannedReminder[] = [];
  for (const plan of plans) {
    const decision = decideForPlan(plan, now, loggedSet);
    if (decision) out.push(decision);
  }
  return out;
}
