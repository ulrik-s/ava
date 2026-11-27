/**
 * Demons avbetalningsplan för `inv-010` ligger alltid efter (#2136), oavsett
 * vilken dag i månaden demon byggs: Avbetalningar visar då "Förfallen N dagar".
 */
import { afterEach, describe, it, expect, vi } from "vitest-compat";
import { paymentPlanOverdue, type PlanOverdueInput } from "@/lib/shared/payment-plan-overdue";
import { buildSeed } from "@/../tooling/scripts/seed-data";

type SeedRow = Record<string, unknown>;

const num = (v: unknown): number => Number(v ?? 0);
const date = (v: unknown): Date | string => (v instanceof Date ? v : String(v));

/** Seedens plan för fakturan, joinad med fakturans belopp och betalningar (seeden har inga avskrivningar). */
function joinedPlan(invoiceId: string): PlanOverdueInput {
  const seed = buildSeed();
  const plan = seed.paymentPlans.find((p) => p.invoiceId === invoiceId);
  const invoice = seed.invoices.find((i) => i.id === invoiceId);
  if (!plan || !invoice) throw new Error(`ingen plan för ${invoiceId}`);
  const payments = seed.payments.filter((r: SeedRow) => r.invoiceId === invoiceId).map((r) => ({ amount: num(r.amount) }));
  return {
    status: String(plan.status), monthlyAmount: num(plan.monthlyAmount), dayOfMonth: num(plan.dayOfMonth),
    startDate: date(plan.startDate), invoice: { amount: num(invoice.amount), payments },
  };
}

afterEach(() => vi.setSystemTime());

describe("seedens plan för inv-010 ligger efter (#2136)", () => {
  for (const today of ["2026-11-01", "2026-11-10", "2026-11-11", "2026-11-28", "2027-03-01"]) {
    it(`byggd ${today}`, () => {
      vi.setSystemTime(new Date(`${today}T12:00:00Z`));
      const overdue = paymentPlanOverdue(joinedPlan("inv-010"), new Date());
      expect(overdue?.overdueDays).toBeGreaterThanOrEqual(15);
      expect(overdue?.behindOre).toBeGreaterThan(0);
    });
  }

  it("de andra aktiva planerna ändras inte: inv-001 har sin betalning kvar", () => {
    vi.setSystemTime(new Date("2026-11-28T12:00:00Z"));
    expect(joinedPlan("inv-001").invoice?.payments).toHaveLength(1);
  });
});
