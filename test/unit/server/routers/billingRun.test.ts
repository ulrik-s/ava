/**
 * billingRun-router — end-to-end tester mot DemoDataStore med riktiga
 * tids- och utläggsrader. Verifierar de fyra flödena:
 *  ACCONTO          — Invoice skapas, raderna fryses INTE
 *  FINAL            — Invoice skapas, alla rader fryses
 *  KOSTNADSRAKNING  — Ingen Invoice ännu, status PENDING_VERDICT
 *  setVerdict       — Invoice + ev. Prutning + frysning
 */
import { describe, it, expect } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";
import { asId } from "@/lib/shared/schemas/ids";

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

  it("proposedAmountOre = %-sats × upparbetat (inga tidigare aconton) — #397", async () => {
    const { caller } = makeCaller({ workMinutes: 120 }); // 5000 kr
    const res = await caller.billingRun.createAcconto({
      matterId: "m-1", clientShareBips: 2000, amountOre: 100000,
    });
    // 20% × 500000 − 0 = 100000
    expect((res.run as { proposedAmountOre: number }).proposedAmountOre).toBe(100000);
  });

  it("proposedAmountOre drar av tidigare ACCONTO-runs (#397)", async () => {
    const { caller } = makeCaller({ workMinutes: 120 }); // 5000 kr
    await caller.billingRun.createAcconto({ matterId: "m-1", clientShareBips: 2000, amountOre: 100000 });
    const second = await caller.billingRun.createAcconto({ matterId: "m-1", clientShareBips: 5000, amountOre: 1 });
    // 50% × 500000 − 100000 (tidigare) = 150000
    expect((second.run as { proposedAmountOre: number }).proposedAmountOre).toBe(150000);
  });
});

describe("billingRun.proposal (#397)", () => {
  it("returnerar ofakturerade poster, upparbetat värde och tidigare aconto-summa", async () => {
    const { caller } = makeCaller({ workMinutes: 120, expenseOre: 90000 }); // 5000 + 900 kr
    await caller.billingRun.createAcconto({ matterId: "m-1", clientShareBips: 2000, amountOre: 60000 });
    const p = await caller.billingRun.proposal({ matterId: "m-1" });
    expect(p.workValueOre).toBe(500000 + 90000);
    expect(p.priorAccontoSumOre).toBe(60000);
    expect(p.timeEntries).toHaveLength(1);
    expect(p.timeEntries[0]!.valueOre).toBe(500000);
    expect(p.expenses).toHaveLength(1);
    expect(p.expenses[0]!.amount).toBe(90000);
  });

  it("utelämnar frysta poster efter en FINAL", async () => {
    const { caller } = makeCaller({ workMinutes: 60 });
    await caller.billingRun.createFinal({ matterId: "m-1", recipient: "KLIENT" });
    const p = await caller.billingRun.proposal({ matterId: "m-1" });
    expect(p.timeEntries).toHaveLength(0);
    expect(p.workValueOre).toBe(0);
  });

  it("nekar ärende i annan org (NOT_FOUND)", async () => {
    const { caller } = makeCaller({ workMinutes: 60 });
    await expect(caller.billingRun.proposal({ matterId: "m-saknas" })).rejects.toThrow();
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

  it("LÄNKAR de debiterbara posterna till fakturan (invoice_id) → vyn visar arvode/utlägg (#728)", async () => {
    const { ds, caller } = makeCaller({ workMinutes: 60, expenseOre: 12500 });
    const res = await caller.billingRun.createFinal({ matterId: "m-1", recipient: "KLIENT" });
    const te = await ds.timeEntries.findFirst({ where: { id: "te-1" } }) as { invoiceId?: string | null };
    const ex = await ds.expenses.findFirst({ where: { id: "ex-1" } }) as { invoiceId?: string | null };
    expect(te.invoiceId).toBe(res.invoice.id); // FÖRR: null → arvode 0.00 i slutfaktura-vyn
    expect(ex.invoiceId).toBe(res.invoice.id); // FÖRR: null → utlägg 0.00
  });

  it("länkar INTE icke-debiterbara poster (de ingår inte i fakturabeloppet)", async () => {
    const { ds, caller } = makeCaller({ workMinutes: 60 });
    await ds.timeEntries.create({ data: { id: asId<"TimeEntryId">("te-nb"), organizationId: "org-1", userId: asId<"UserId">("u-1"), matterId: asId<"MatterId">("m-1"), date: new Date(), minutes: 30, description: "Intern", hourlyRate: 250000, billable: false } });
    const res = await caller.billingRun.createFinal({ matterId: "m-1", recipient: "KLIENT" });
    const nb = await ds.timeEntries.findFirst({ where: { id: "te-nb" } }) as { invoiceId?: string | null; frozenAt?: Date | null };
    expect(nb.invoiceId).toBeFalsy(); // ej fakturerad
    expect(nb.frozenAt).toBeInstanceOf(Date); // men ändå fryst (med i körningen)
    expect(res.run.amountOre).toBe(250000); // bara debiterbar tid räknas
  });

  it("drar av tidigare ACCONTO-runs på slutbeloppet + skapar acconto_deduction-rad (#728)", async () => {
    const { ds, caller } = makeCaller({ workMinutes: 120 }); // 5000 kr värde
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
    // Acconto-avdraget materialiseras så slutfaktura-vyns "att betala" stämmer.
    const ded = await ds.accontoDeductions.findFirst({ where: { finalInvoiceId: fin.invoice.id } }) as { accontoInvoiceId?: string } | null;
    expect(ded?.accontoInvoiceId).toBe(acc.invoice.id);
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
