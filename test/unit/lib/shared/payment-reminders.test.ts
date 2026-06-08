/**
 * `payment-reminders` — ren scan-kärna (#23). Låser DUE/OVERDUE-semantiken,
 * remaining-grinden, företrädet och idempotensen.
 */
import { describe, it, expect } from "vitest-compat";
import { computeDueReminders, type PlanForScan, type LoggedReminder } from "@/lib/shared/payment-reminders";

function plan(over: Partial<PlanForScan> = {}): PlanForScan {
  return {
    planId: "pp-1", status: "ACTIVE", monthlyAmount: 50000, dayOfMonth: 10,
    startDate: new Date("2026-01-15T00:00:00Z"),
    invoiceTotalOre: 600000, paidOre: 0,
    matterId: "m-1", matterNumber: "2026-0001", matterTitle: "Tvist",
    recipientEmail: "klient@example.se", recipientName: "Klient AB",
    ...over,
  };
}

const NONE: LoggedReminder[] = [];

describe("computeDueReminders — DUE", () => {
  // Plan startad innevarande månad → ingen föregående månad → isolerar DUE-vägen.
  const thisMonth = () => plan({ startDate: new Date("2026-03-01T00:00:00Z") });

  it("DUE för innevarande månad när today >= dayOfMonth", () => {
    const out = computeDueReminders([thisMonth()], new Date("2026-03-10T09:00:00Z"), NONE);
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("DUE");
    expect(out[0]!.dueMonth).toBe("2026-03");
    expect(out[0]!.eventType).toBe("payment.due");
    expect(out[0]!.idempotencyKey).toBe("payment.due:pp-1:2026-03");
    expect(out[0]!.payload).toMatchObject({ recipientEmail: "klient@example.se", monthlyAmount: 50000, remainingAmount: 600000 });
  });

  it("ingen DUE före dayOfMonth", () => {
    expect(computeDueReminders([thisMonth()], new Date("2026-03-05T09:00:00Z"), NONE)).toHaveLength(0);
  });

  it("idempotens: redan loggad DUE → ingen ny", () => {
    const logged: LoggedReminder[] = [{ planId: "pp-1", dueMonth: "2026-03", type: "DUE" }];
    expect(computeDueReminders([thisMonth()], new Date("2026-03-10T09:00:00Z"), logged)).toHaveLength(0);
  });
});

describe("computeDueReminders — OVERDUE", () => {
  it("OVERDUE för föregående månad, går före DUE", () => {
    const out = computeDueReminders([plan()], new Date("2026-03-10T09:00:00Z"), NONE);
    // plan startade 2026-01 → föregående månad (2026-02) eskaleras före DUE.
    // (NONE-loggen ⇒ OVERDUE vinner företräde.)
    expect(out[0]!.type).toBe("OVERDUE");
    expect(out[0]!.dueMonth).toBe("2026-02");
    expect(out[0]!.eventType).toBe("payment.overdue");
  });

  it("ingen backfill: plan startad innevarande månad → ingen OVERDUE", () => {
    const p = plan({ startDate: new Date("2026-03-01T00:00:00Z") });
    const out = computeDueReminders([p], new Date("2026-03-10T09:00:00Z"), NONE);
    expect(out[0]!.type).toBe("DUE"); // bara innevarande månad
  });

  it("loggad OVERDUE för föreg. månad → faller igenom till DUE", () => {
    const logged: LoggedReminder[] = [{ planId: "pp-1", dueMonth: "2026-02", type: "OVERDUE" }];
    const out = computeDueReminders([plan()], new Date("2026-03-10T09:00:00Z"), logged);
    expect(out[0]!.type).toBe("DUE");
    expect(out[0]!.dueMonth).toBe("2026-03");
  });
});

describe("computeDueReminders — grindar", () => {
  it("remaining <= 0 (betald) → ingen påminnelse", () => {
    expect(computeDueReminders([plan({ paidOre: 600000 })], new Date("2026-03-10T09:00:00Z"), NONE)).toHaveLength(0);
  });
  it("ej ACTIVE → ingen påminnelse", () => {
    expect(computeDueReminders([plan({ status: "CANCELLED" })], new Date("2026-03-10T09:00:00Z"), NONE)).toHaveLength(0);
    expect(computeDueReminders([plan({ status: "COMPLETED" })], new Date("2026-03-10T09:00:00Z"), NONE)).toHaveLength(0);
  });
  it("remaining beräknas som total − betalt", () => {
    const out = computeDueReminders([plan({ paidOre: 100000 })], new Date("2026-03-10T09:00:00Z"), [{ planId: "pp-1", dueMonth: "2026-02", type: "OVERDUE" }]);
    expect(out[0]!.payload.remainingAmount).toBe(500000);
  });
});
