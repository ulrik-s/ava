/**
 * billingRun-router — end-to-end tester mot DemoDataStore med riktiga
 * tids- och utläggsrader. Verifierar de fyra flödena:
 *  ACCONTO          — Invoice skapas, raderna fryses INTE
 *  FINAL            — Invoice skapas, alla rader fryses
 *  KOSTNADSRAKNING  — Ingen Invoice ännu, status PENDING_VERDICT
 *  setVerdict       — Invoice + ev. Prutning + frysning
 */
import { describe, it, expect } from "vitest-compat";
import { appRouter } from "@/lib/server/routers/_app";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { buildContext } from "@/lib/server/build-context";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";

const PRINCIPAL: Principal = {
  id: "u-1", email: "a@x", name: "Anna", role: "ADMIN", organizationId: "org-1",
};

function makeCaller(opts?: { workMinutes?: number; expenseOre?: number }) {
  const ds = new DemoDataStore({
    organizations: [{ id: "org-1", name: "X" }],
    matters: [{ id: "m-1", organizationId: "org-1", matterNumber: "2026-0001", title: "Test", status: "ACTIVE", paymentMethod: "RATTSSKYDD", createdAt: new Date() }],
    users: [{ id: "u-1", organizationId: "org-1", email: "a@x", name: "Anna", role: "ADMIN", hourlyRate: 250000 }],
    timeEntries: [{ id: "te-1", organizationId: "org-1", userId: "u-1", matterId: "m-1", date: new Date(), minutes: opts?.workMinutes ?? 120, description: "Möte", hourlyRate: 250000, billable: true }],
    expenses: opts?.expenseOre != null ? [{ id: "ex-1", organizationId: "org-1", userId: "u-1", matterId: "m-1", date: new Date(), amount: opts.expenseOre, description: "Avgift", billable: true, vatRate: 0, vatIncluded: false, kind: "EXPENSE" }] : [],
  }, async () => { /* writable: noop write-back */ });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ds, caller: appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL }) as any) };
}

describe("billingRun.createAcconto", () => {
  it("skapar BillingRun + Invoice (ACCONTO) men FRYSER INTE raderna", async () => {
    const { ds, caller } = makeCaller({ workMinutes: 120 }); // 2h × 2500kr = 5000kr = 500000öre
    const res = await caller.billingRun.createAcconto({
      matterId: "m-1", clientShareBips: 2000, amountOre: 100000,
    });
    expect(res.run.type).toBe("ACCONTO");
    expect(res.run.status).toBe("SENT");
    expect(res.run.workValueOreAtRun).toBe(500000);
    expect(res.run.amountOre).toBe(100000);
    expect(res.invoice.invoiceType).toBe("ACCONTO");
    // Rader är INTE frysta
    const te = await ds.timeEntries.findFirst({ where: { id: "te-1" } }) as { frozenAt?: Date | null };
    expect(te.frozenAt).toBeFalsy();
  });
});

describe("billingRun.createFinal", () => {
  it("skapar FINAL Invoice + FRYSER alla rader", async () => {
    const { ds, caller } = makeCaller({ workMinutes: 60, expenseOre: 12500 });
    const res = await caller.billingRun.createFinal({
      matterId: "m-1", recipient: "KLIENT",
    });
    expect(res.run.type).toBe("FINAL");
    expect(res.run.amountOre).toBe(250000 + 12500); // 1h × 2500 + 125 = 2625 kr
    const te = await ds.timeEntries.findFirst({ where: { id: "te-1" } }) as { frozenAt?: Date | null; frozenByBillingRunId?: string | null };
    expect(te.frozenAt).toBeInstanceOf(Date);
    expect(te.frozenByBillingRunId).toBe(res.run.id);
  });

  it("drar av tidigare ACCONTO-runs på slutbeloppet", async () => {
    const { caller } = makeCaller({ workMinutes: 120 }); // 5000 kr värde
    const acc = await caller.billingRun.createAcconto({
      matterId: "m-1", clientShareBips: 2000, amountOre: 100000,
    });
    const fin = await caller.billingRun.createFinal({
      matterId: "m-1", recipient: "FORSAKRING",
      deductedBillingRunIds: [acc.run.id],
    });
    // 500000 - 100000 = 400000
    expect(fin.run.amountOre).toBe(400000);
    expect(fin.run.deductedBillingRunIds).toEqual([acc.run.id]);
  });

  it("vägrar avdrag mot okänt/fel-scopat billing-run-id (#60)", async () => {
    const { caller } = makeCaller({ workMinutes: 120 });
    await expect(caller.billingRun.createFinal({
      matterId: "m-1", recipient: "KLIENT",
      deductedBillingRunIds: ["br-finns-ej"],
    })).rejects.toThrow(/tillhör inte detta ärende|ACCONTO/);
  });
});

describe("billingRun.createKostnadsrakning", () => {
  it("skapar BillingRun i PENDING_VERDICT utan Invoice", async () => {
    const { caller } = makeCaller({ workMinutes: 180 });
    const res = await caller.billingRun.createKostnadsrakning({ matterId: "m-1" });
    expect(res.run.type).toBe("KOSTNADSRAKNING");
    expect(res.run.status).toBe("PENDING_VERDICT");
    expect(res.run.invoiceId).toBeFalsy();
    expect(res.run.workValueOreAtRun).toBe(750000); // 3h × 2500 kr
  });

  it("fryser INTE rader (väntar tills setVerdict)", async () => {
    const { ds, caller } = makeCaller({ workMinutes: 60 });
    await caller.billingRun.createKostnadsrakning({ matterId: "m-1" });
    const te = await ds.timeEntries.findFirst({ where: { id: "te-1" } }) as { frozenAt?: Date | null };
    expect(te.frozenAt).toBeFalsy();
  });
});

describe("billingRun.setVerdict", () => {
  it("transitionar PENDING_VERDICT → SENT, skapar Invoice + fryser rader", async () => {
    const { ds, caller } = makeCaller({ workMinutes: 60 }); // 2500 kr
    const kr = await caller.billingRun.createKostnadsrakning({ matterId: "m-1" });
    const res = await caller.billingRun.setVerdict({
      billingRunId: kr.run.id, prutningOre: 0,
    });
    expect(res.run.id).toBe(kr.run.id);
    const updated = await ds.billingRuns.findFirst({ where: { id: kr.run.id } }) as { status: string; invoiceId: string };
    expect(updated.status).toBe("SENT");
    expect(updated.invoiceId).toBe(res.invoice.id);
    const te = await ds.timeEntries.findFirst({ where: { id: "te-1" } }) as { frozenByBillingRunId?: string | null };
    expect(te.frozenByBillingRunId).toBe(kr.run.id);
  });

  it("skapar Expense(kind=PRUTNING) när prutning angiven", async () => {
    const { ds, caller } = makeCaller({ workMinutes: 60 });
    const kr = await caller.billingRun.createKostnadsrakning({ matterId: "m-1" });
    await caller.billingRun.setVerdict({
      billingRunId: kr.run.id, prutningOre: -50000,
    });
    const prutning = await ds.expenses.findFirst({ where: { matterId: "m-1", kind: "PRUTNING" } }) as { amount: number; description: string };
    expect(prutning).toBeTruthy();
    expect(prutning.amount).toBe(-50000);
    expect(prutning.description).toMatch(/prutning/i);
  });

  it("invoice-beloppet är workValue + prutning (prutning negativ)", async () => {
    const { caller } = makeCaller({ workMinutes: 120 }); // 5000 kr
    const kr = await caller.billingRun.createKostnadsrakning({ matterId: "m-1" });
    const res = await caller.billingRun.setVerdict({
      billingRunId: kr.run.id, prutningOre: -100000,
    });
    expect(res.invoice.amount).toBe(400000); // 500 - 100
  });

  it("kastar om billing-run inte är KOSTNADSRAKNING", async () => {
    const { caller } = makeCaller({ workMinutes: 60 });
    const acc = await caller.billingRun.createAcconto({
      matterId: "m-1", clientShareBips: 2000, amountOre: 50000,
    });
    await expect(caller.billingRun.setVerdict({
      billingRunId: acc.run.id, prutningOre: 0,
    })).rejects.toThrow(/KOSTNADSRAKNING/);
  });
});

describe("billingRun.list / byId", () => {
  it("list returnerar runs för ärendet", async () => {
    const { caller } = makeCaller({ workMinutes: 60 });
    await caller.billingRun.createAcconto({ matterId: "m-1", clientShareBips: 2000, amountOre: 50000 });
    const { runs } = await caller.billingRun.list({ matterId: "m-1" });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.type).toBe("ACCONTO");
  });
});
