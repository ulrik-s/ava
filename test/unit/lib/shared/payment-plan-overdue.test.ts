/**
 * `paymentPlanOverdue` (#2136): när en aktiv avbetalningsplan ligger efter,
 * sedan vilken förfallodag och med hur mycket.
 */
import { describe, it, expect } from "vitest-compat";
import type { JoinedPaymentPlan } from "@/lib/server/repositories/payment-plan-repository";
import { paymentPlanOverdue, type PlanOverdueInput } from "@/lib/shared/payment-plan-overdue";

/** Svensk middag en given dag, så att testerna inte beror på klockslaget. */
const day = (ymd: string): Date => new Date(`${ymd}T10:00:00Z`);

function plan(over: Partial<PlanOverdueInput> = {}, paid: number[] = [], writtenOff: number[] = []): PlanOverdueInput {
  return {
    status: "ACTIVE", monthlyAmount: 100_000, dayOfMonth: 25, startDate: "2026-09-20",
    invoice: { amount: 500_000, payments: paid.map((amount) => ({ amount })), writeOffs: writtenOff.map((amount) => ({ amount })) },
    ...over,
  };
}

describe("paymentPlanOverdue", () => {
  it("exemplet: två förfallna delbetalningar, 150 000 betalt → 50 000 efter sedan 2026-10-25, 31 dagar", () => {
    expect(paymentPlanOverdue(plan({}, [150_000]), day("2026-11-25")))
      .toEqual({ dueDate: "2026-10-25", overdueDays: 31, behindOre: 50_000 });
  });

  it("förfallodagen i dag är inte förfallen, dagen efter är 1 dag", () => {
    expect(paymentPlanOverdue(plan(), day("2026-09-25"))).toBeNull();
    expect(paymentPlanOverdue(plan(), day("2026-09-26"))).toEqual({ dueDate: "2026-09-25", overdueDays: 1, behindOre: 100_000 });
  });

  it("den första förfallodagen är planens dag på eller efter startdatumet", () => {
    // Dag 25 efter startdagen 20: samma månad.
    expect(paymentPlanOverdue(plan({ startDate: "2026-11-20" }), day("2026-11-26"))?.dueDate).toBe("2026-11-25");
    // Dag 5 före startdagen 20: nästa månad.
    expect(paymentPlanOverdue(plan({ startDate: "2026-11-20", dayOfMonth: 5 }), day("2026-12-05"))).toBeNull();
    expect(paymentPlanOverdue(plan({ startDate: "2026-11-20", dayOfMonth: 5 }), day("2026-12-06"))?.dueDate).toBe("2026-12-05");
    // Samma dag som starten: aldrig förfallen samma dag som den läggs upp.
    expect(paymentPlanOverdue(plan({ startDate: "2026-11-20", dayOfMonth: 20 }), day("2026-11-20"))).toBeNull();
  });

  it("före den första förfallodagen ligger ingen plan efter", () => {
    expect(paymentPlanOverdue(plan(), day("2026-09-21"))).toBeNull();
  });

  it("delbetalt: den äldsta obetalda delbetalningens förfallodag och rätt belopp efter", () => {
    expect(paymentPlanOverdue(plan({}, [100_000, 50_000]), day("2026-12-01")))
      .toEqual({ dueDate: "2026-10-25", overdueDays: 37, behindOre: 150_000 });
  });

  it("betalt ikapp, eller före planen, ger null", () => {
    expect(paymentPlanOverdue(plan({}, [200_000]), day("2026-11-25"))).toBeNull();
    expect(paymentPlanOverdue(plan({}, [400_000]), day("2026-11-25"))).toBeNull();
  });

  it("den sista delbetalningen kan vara mindre: att ha betalat är högst fakturans belopp", () => {
    const p = plan({ invoice: { amount: 250_000, payments: [{ amount: 200_000 }] } });
    expect(paymentPlanOverdue(p, day("2027-06-01"))).toEqual({ dueDate: "2026-11-25", overdueDays: 188, behindOre: 50_000 });
    expect(paymentPlanOverdue({ ...p, invoice: { amount: 250_000, payments: [{ amount: 250_000 }] } }, day("2027-06-01"))).toBeNull();
  });

  it("avskrivet räknas som betalt (ADR 0007)", () => {
    expect(paymentPlanOverdue(plan({}, [100_000], [100_000]), day("2026-11-25"))).toBeNull();
    expect(paymentPlanOverdue(plan({}, [], [100_000]), day("2026-10-26"))?.behindOre).toBe(100_000);
  });

  it("slutförd, avbruten, utan faktura eller utan belopp ger null", () => {
    const now = day("2027-01-01");
    expect(paymentPlanOverdue(plan({ status: "COMPLETED" }), now)).toBeNull();
    expect(paymentPlanOverdue(plan({ status: "CANCELLED" }), now)).toBeNull();
    expect(paymentPlanOverdue(plan({ invoice: null }), now)).toBeNull();
    expect(paymentPlanOverdue(plan({ invoice: undefined }), now)).toBeNull();
    expect(paymentPlanOverdue(plan({ invoice: { amount: null } }), now)).toBeNull();
    expect(paymentPlanOverdue(plan({ invoice: {} }), now)).toBeNull();
  });

  it("utan betalningar och avskrivningar i fakturan räknas betalt som 0", () => {
    expect(paymentPlanOverdue(plan({ invoice: { amount: 500_000, payments: null, writeOffs: null } }), day("2026-09-26"))?.behindOre).toBe(100_000);
  });

  it("räknar på svensk kalenderdag: 22:30 UTC den 25 september är den 26:e i Sverige", () => {
    expect(paymentPlanOverdue(plan(), new Date("2026-09-25T21:30:00Z"))).toBeNull();
    expect(paymentPlanOverdue(plan(), new Date("2026-09-25T22:30:00Z"))?.overdueDays).toBe(1);
  });

  it("startdatum som Date och som ISO-sträng ger samma svar", () => {
    const now = day("2026-11-25");
    const asString = paymentPlanOverdue(plan({ startDate: "2026-09-20T08:00:00.000Z" }, [150_000]), now);
    expect(paymentPlanOverdue(plan({ startDate: new Date("2026-09-20T08:00:00.000Z") }, [150_000]), now)).toEqual(asString);
  });

  it("tar repots joinade plan utan omvandling (typkontrollen räcker)", () => {
    const fromRepo = (p: JoinedPaymentPlan) => paymentPlanOverdue(p, day("2026-11-25"));
    expect(typeof fromRepo).toBe("function");
  });
});
