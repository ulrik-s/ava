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
  id: asId<"UserId">("u-1"), email: "a@x", name: "Anna", role: "ADMIN", organizationId: asId<"OrganizationId">("org-1"),
};

function makeCaller(opts?: { workMinutes?: number; expenseOre?: number; paymentMethod?: string }) {
  const ds = new DemoDataStore({
    organizations: [{ id: "org-1", name: "X" }],
    matters: [{ id: "m-1", organizationId: "org-1", matterNumber: "2026-0001", title: "Test", status: "ACTIVE", paymentMethod: opts?.paymentMethod ?? "RATTSSKYDD", createdAt: new Date() }],
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
    expect(res.invoice.invoiceNumber).toMatch(/^F-\d{4}-\d+$/); // numreras (#730)
    expect(res.invoice.ocrReference).toBeTruthy();
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
    expect(res.run.amountOre).toBe(312500 + 12500); // 1h × 2500 + 25 % moms + 125 utlägg (#782)
    const te = await ds.timeEntries.findFirst({ where: { id: "te-1" } }) as { frozenAt?: Date | null; frozenByBillingRunId?: string | null };
    expect(te.frozenAt).toBeInstanceOf(Date);
    expect(te.frozenByBillingRunId).toBe(res.run.id);
  });

  it("sätter invoice.vatOre = arvodets moms exakt (per sats, #782)", async () => {
    const { caller } = makeCaller({ workMinutes: 60 }); // arvode 2500 kr netto
    const res = await caller.billingRun.createFinal({ matterId: "m-1", recipient: "KLIENT" });
    expect(res.invoice.vatOre).toBe(62500); // 25 % på 250000 öre
  });

  it("tilldelar fakturanummer + OCR (klient) — ADR 0012 (#730)", async () => {
    const { caller } = makeCaller({ workMinutes: 60 });
    const res = await caller.billingRun.createFinal({ matterId: "m-1", recipient: "KLIENT" });
    expect(res.invoice.invoiceNumber).toMatch(/^F-\d{4}-\d+$/);
    expect(res.invoice.ocrReference).toBeTruthy();
  });

  it("DOMSTOL-mottagare → inget fakturanummer/OCR (ADR 0012)", async () => {
    const { caller } = makeCaller({ workMinutes: 60 });
    const res = await caller.billingRun.createFinal({ matterId: "m-1", recipient: "DOMSTOL" });
    expect(res.invoice.invoiceNumber).toBeFalsy();
    expect(res.invoice.ocrReference).toBeFalsy();
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
    expect(res.run.amountOre).toBe(312500); // bara debiterbar tid räknas (arvode inkl 25 % moms, #782)
  });

  it("per-post-val: fakturerar ENBART valda poster, lämnar resten ofryst (#734)", async () => {
    const { ds, caller } = makeCaller({ workMinutes: 60, expenseOre: 5000 }); // te-1 (2500kr) + ex-1 (50kr)
    await ds.timeEntries.create({ data: { id: asId<"TimeEntryId">("te-2"), organizationId: "org-1", userId: asId<"UserId">("u-1"), matterId: asId<"MatterId">("m-1"), date: new Date(), minutes: 60, description: "B", hourlyRate: 250000, billable: true } });
    const res = await caller.billingRun.createFinal({ matterId: "m-1", recipient: "KLIENT", timeEntryIds: ["te-1"], expenseIds: [] });
    expect(res.invoice.amount).toBe(312500); // bara te-1 (arvode inkl 25 % moms), inget utlägg
    const t1 = await ds.timeEntries.findFirst({ where: { id: "te-1" } }) as { invoiceId?: string | null; frozenAt?: Date | null };
    const t2 = await ds.timeEntries.findFirst({ where: { id: "te-2" } }) as { invoiceId?: string | null; frozenAt?: Date | null };
    const e1 = await ds.expenses.findFirst({ where: { id: "ex-1" } }) as { frozenAt?: Date | null };
    expect(t1.invoiceId).toBe(res.invoice.id);
    expect(t1.frozenAt).toBeInstanceOf(Date);
    expect(t2.invoiceId).toBeFalsy(); // ej vald → kvar ofryst för senare
    expect(t2.frozenAt).toBeFalsy();
    expect(e1.frozenAt).toBeFalsy(); // expenseIds=[] → utlägg ej med
  });

  it("per-post-val validerar id:n (okänt/fel-scopat → fel)", async () => {
    const { caller } = makeCaller({ workMinutes: 60 });
    await expect(caller.billingRun.createFinal({
      matterId: "m-1", recipient: "KLIENT", timeEntryIds: ["finns-ej"], expenseIds: [],
    })).rejects.toThrow(/redan fakturerad|annat ärende/);
  });

  it("utan per-post-val → fakturerar allt ofryst (default oförändrat)", async () => {
    const { ds, caller } = makeCaller({ workMinutes: 60, expenseOre: 5000 });
    const res = await caller.billingRun.createFinal({ matterId: "m-1", recipient: "KLIENT" });
    expect(res.invoice.amount).toBe(312500 + 5000); // arvode inkl 25 % moms + utlägg (#782)
    const t1 = await ds.timeEntries.findFirst({ where: { id: "te-1" } }) as { frozenAt?: Date | null };
    expect(t1.frozenAt).toBeInstanceOf(Date);
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
    // arvode 5000 kr + 25 % moms = 625000 öre, − acconto 100000 = 525000 (#782)
    expect(fin.run.amountOre).toBe(525000);
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
    const { caller } = makeCaller({ workMinutes: 180, paymentMethod: "OFFENTLIGT_UPPDRAG" });
    const res = await caller.billingRun.createKostnadsrakning({ matterId: "m-1" });
    expect(res.run.type).toBe("KOSTNADSRAKNING");
    expect(res.run.status).toBe("PENDING_VERDICT");
    expect(res.run.invoiceId).toBeFalsy();
    expect(res.run.workValueOreAtRun).toBe(937500); // 3h × 2500 kr + 25 % moms (#782)
  });

  it("fryser raderna vid inskick mot körningen (#806 — lämnar 'upparbetat ofakturerat')", async () => {
    const { ds, caller } = makeCaller({ workMinutes: 60, paymentMethod: "OFFENTLIGT_UPPDRAG" });
    const res = await caller.billingRun.createKostnadsrakning({ matterId: "m-1" });
    const te = await ds.timeEntries.findFirst({ where: { id: "te-1" } }) as { frozenAt?: Date | null; frozenByBillingRunId?: string | null };
    expect(te.frozenAt).toBeTruthy();
    expect(te.frozenByBillingRunId).toBe(res.run.id);
  });

  it("rättshjälp värderas på timkostnadsnormen (F-skatt) minus rådgivningstimmen (#839)", async () => {
    // 120 min billable, INTE byråns 2500 kr/h: rättshjälp → timkostnadsnorm 1626 kr/h.
    // Rådgivningstimmen (60 min) exkluderas → 60 min kvar = 1 h × 162600 = 162600 netto,
    // + 25 % moms = 203250 brutto (inga utlägg). Byråns privata taxa ignoreras.
    const { caller } = makeCaller({ workMinutes: 120, paymentMethod: "RATTSHJALP" });
    const res = await caller.billingRun.createKostnadsrakning({ matterId: "m-1" });
    expect(res.run.workValueOreAtRun).toBe(203250);
  });
});

describe("billingRun.setVerdict", () => {
  // #828: fakturan skapas EFTER domstolens beslut — prutningen registreras på
  // KR:n (recordKostnadsrakningBeslut) och läses sedan ur körningen, inte som input.
  it("transitionar BESLUTAD → SENT, skapar Invoice + fryser rader", async () => {
    const { ds, caller } = makeCaller({ workMinutes: 60, paymentMethod: "OFFENTLIGT_UPPDRAG" }); // 2500 kr
    const kr = await caller.billingRun.createKostnadsrakning({ matterId: "m-1" });
    await caller.billingRun.recordKostnadsrakningBeslut({ billingRunId: kr.run.id, awardedOre: 312500 });
    const res = await caller.billingRun.setVerdict({ billingRunId: kr.run.id });
    expect(res.run.id).toBe(kr.run.id);
    const updated = await ds.billingRuns.findFirst({ where: { id: kr.run.id } }) as { status: string; invoiceId: string; kostnadsrakningStatus: string };
    expect(updated.status).toBe("SENT");
    expect(updated.kostnadsrakningStatus).toBe("FAKTURERAD");
    expect(updated.invoiceId).toBe(res.invoice.id);
    const te = await ds.timeEntries.findFirst({ where: { id: "te-1" } }) as { frozenByBillingRunId?: string | null };
    expect(te.frozenByBillingRunId).toBe(kr.run.id);
  });

  it("skapar Expense(kind=PRUTNING) när prutning registrerats på beslutet", async () => {
    const { ds, caller } = makeCaller({ workMinutes: 60, paymentMethod: "OFFENTLIGT_UPPDRAG" });
    const kr = await caller.billingRun.createKostnadsrakning({ matterId: "m-1" });
    await caller.billingRun.recordKostnadsrakningBeslut({ billingRunId: kr.run.id, awardedOre: 262500, prutningOre: -50000 });
    await caller.billingRun.setVerdict({ billingRunId: kr.run.id });
    const prutning = await ds.expenses.findFirst({ where: { matterId: "m-1", kind: "PRUTNING" } }) as { amount: number; description: string };
    expect(prutning).toBeTruthy();
    expect(prutning.amount).toBe(-50000);
    expect(prutning.description).toMatch(/prutning/i);
  });

  it("invoice-beloppet är workValue + prutning (prutning negativ)", async () => {
    const { caller } = makeCaller({ workMinutes: 120, paymentMethod: "OFFENTLIGT_UPPDRAG" }); // 5000 kr
    const kr = await caller.billingRun.createKostnadsrakning({ matterId: "m-1" });
    await caller.billingRun.recordKostnadsrakningBeslut({ billingRunId: kr.run.id, awardedOre: 525000, prutningOre: -100000 });
    const res = await caller.billingRun.setVerdict({ billingRunId: kr.run.id });
    expect(res.invoice.amount).toBe(525000); // arvode 5000 kr + moms = 625000, − prutning 1000 = 525000 (#782)
  });

  it("LÄNKAR poster + PRUTNING till fakturan → vyn reconciler mot beloppet (#732)", async () => {
    const { ds, caller } = makeCaller({ workMinutes: 120, expenseOre: 5000, paymentMethod: "OFFENTLIGT_UPPDRAG" }); // 5000 kr + 50 kr utlägg
    const kr = await caller.billingRun.createKostnadsrakning({ matterId: "m-1" });
    await caller.billingRun.recordKostnadsrakningBeslut({ billingRunId: kr.run.id, awardedOre: 595000, prutningOre: -30000 });
    const res = await caller.billingRun.setVerdict({ billingRunId: kr.run.id });
    const te = await ds.timeEntries.findFirst({ where: { id: "te-1" } }) as { invoiceId?: string | null };
    const ex = await ds.expenses.findFirst({ where: { id: "ex-1" } }) as { invoiceId?: string | null };
    const prut = await ds.expenses.findFirst({ where: { matterId: "m-1", kind: "PRUTNING" } }) as { invoiceId?: string | null };
    expect(te.invoiceId).toBe(res.invoice.id); // arvode länkad
    expect(ex.invoiceId).toBe(res.invoice.id); // utlägg länkad
    expect(prut.invoiceId).toBe(res.invoice.id); // PRUTNING länkad (reducerar totalen)
    // Arvode 5000 kr + 25 % moms = 625000, + utlägg 50 kr − prutning 300 kr (#782).
    expect(res.invoice.amount).toBe(625000 + 5000 - 30000);
  });

  it("DOMSTOL-faktura får inget fakturanummer (ADR 0012)", async () => {
    const { caller } = makeCaller({ workMinutes: 60, paymentMethod: "OFFENTLIGT_UPPDRAG" });
    const kr = await caller.billingRun.createKostnadsrakning({ matterId: "m-1" });
    await caller.billingRun.recordKostnadsrakningBeslut({ billingRunId: kr.run.id, awardedOre: 312500 });
    const res = await caller.billingRun.setVerdict({ billingRunId: kr.run.id });
    expect(res.invoice.invoiceNumber).toBeFalsy();
    expect(res.invoice.ocrReference).toBeFalsy();
  });

  it("kastar om fakturan skapas innan beslutet registrerats (INSKICKAD)", async () => {
    const { caller } = makeCaller({ workMinutes: 60, paymentMethod: "OFFENTLIGT_UPPDRAG" });
    const kr = await caller.billingRun.createKostnadsrakning({ matterId: "m-1" });
    await expect(caller.billingRun.setVerdict({ billingRunId: kr.run.id })).rejects.toThrow(/beslut/i);
  });

  it("kastar om billing-run inte är KOSTNADSRAKNING", async () => {
    const { caller } = makeCaller({ workMinutes: 60 });
    const acc = await caller.billingRun.createAcconto({
      matterId: "m-1", clientShareBips: 2000, amountOre: 50000,
    });
    await expect(caller.billingRun.setVerdict({
      billingRunId: acc.run.id,
    })).rejects.toThrow(/kostnadsräkning/i);
  });
});

describe("billingRun — KR-livscykel (#828): beslut + överklagan", () => {
  const kr = async () => {
    const { caller } = makeCaller({ workMinutes: 60, paymentMethod: "OFFENTLIGT_UPPDRAG" });
    const created = await caller.billingRun.createKostnadsrakning({ matterId: "m-1" });
    return { caller, runId: created.run.id, created };
  };

  it("createKostnadsrakning startar i INSKICKAD", async () => {
    const { created } = await kr();
    expect((created.run as { kostnadsrakningStatus?: string }).kostnadsrakningStatus).toBe("INSKICKAD");
  });

  it("recordKostnadsrakningBeslut: INSKICKAD → BESLUTAD + sparar dömt belopp/prutning", async () => {
    const { caller, runId } = await kr();
    const res = await caller.billingRun.recordKostnadsrakningBeslut({ billingRunId: runId, awardedOre: 200000, prutningOre: -50000 });
    const r = res.run as { kostnadsrakningStatus: string; awardedOre: number; beslutSlutgiltigt: boolean };
    expect(r.kostnadsrakningStatus).toBe("BESLUTAD");
    expect(r.awardedOre).toBe(200000);
    expect(r.beslutSlutgiltigt).toBe(false);
  });

  it("överklagan → hovrättsbeslut (slutgiltigt), ingen dubbel-överklagan", async () => {
    const { caller, runId } = await kr();
    await caller.billingRun.recordKostnadsrakningBeslut({ billingRunId: runId, awardedOre: 200000 });
    const appealed = await caller.billingRun.appealKostnadsrakning({ billingRunId: runId });
    expect((appealed.run as { kostnadsrakningStatus: string }).kostnadsrakningStatus).toBe("OVERKLAGAD");
    const hovr = await caller.billingRun.recordKostnadsrakningBeslut({ billingRunId: runId, awardedOre: 250000 });
    const r = hovr.run as { kostnadsrakningStatus: string; beslutSlutgiltigt: boolean; awardedOre: number };
    expect(r.kostnadsrakningStatus).toBe("BESLUTAD");
    expect(r.beslutSlutgiltigt).toBe(true);
    expect(r.awardedOre).toBe(250000);
    await expect(caller.billingRun.appealKostnadsrakning({ billingRunId: runId })).rejects.toThrow(/inte tillåten/);
  });

  it("överklagan innan beslut är otillåten", async () => {
    const { caller, runId } = await kr();
    await expect(caller.billingRun.appealKostnadsrakning({ billingRunId: runId })).rejects.toThrow(/inte tillåten/);
  });
});

describe("billingRun — flödes-guard (#816 fas 3)", () => {
  it("avvisar kostnadsräkning på ett RÄTTSSKYDD-ärende (otillåten övergång)", async () => {
    const { caller } = makeCaller({ workMinutes: 60, paymentMethod: "RATTSSKYDD" });
    await expect(caller.billingRun.createKostnadsrakning({ matterId: "m-1" })).rejects.toThrow(/inte tillåten/);
  });

  it("avvisar slutreglering på ett PRIVAT-ärende (SETTLE saknas i flödet)", async () => {
    const { caller } = makeCaller({ workMinutes: 60, paymentMethod: "PRIVAT" });
    await expect(caller.billingRun.settleCoverage({ matterId: "m-1", payerRecipient: "KLIENT" })).rejects.toThrow(/inte tillåten/);
  });

  it("tillåter aconto + slutfaktura på ett PRIVAT-ärende (löpande räkning)", async () => {
    const { caller } = makeCaller({ workMinutes: 60, paymentMethod: "PRIVAT" });
    await caller.billingRun.createAcconto({ matterId: "m-1", clientShareBips: 0, amountOre: 50000 });
    const res = await caller.billingRun.createFinal({ matterId: "m-1", recipient: "KLIENT" });
    expect(res.run.type).toBe("FINAL");
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

describe("billingRun.coverageSplit — prutning/självrisk på aktuellt timarvode (#800)", () => {
  function caller(matterExtra: Record<string, unknown>, currentRate: number, minutes = 120) {
    const ds = new DemoDataStore({
      organizations: [{ id: "org-1", name: "X" }],
      matters: [{ id: "m-1", organizationId: "org-1", matterNumber: "2026-0001", title: "T", status: "ACTIVE", responsibleLawyerId: "u-1", ...matterExtra, createdAt: new Date() }],
      // Juristens AKTUELLA timtaxa = currentRate (skiljer sig från tidspostens snapshot 200000).
      users: [{ id: "u-1", organizationId: "org-1", email: "a@x", name: "Anna", role: "ADMIN", hourlyRate: currentRate }],
      timeEntries: [{ id: "te-1", organizationId: "org-1", userId: "u-1", matterId: "m-1", date: new Date(), minutes, description: "M", hourlyRate: 200000, billable: true }],
    }, async () => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL }) as any);
  }

  it("rättsskydd: värderar på juristens AKTUELLA timtaxa (ej snapshot) + klient tar prutningen", async () => {
    // 2 tim × aktuell 3000 kr/h = 6000 kr total (INTE snapshot 2000 kr/h = 4000).
    const c = caller({ paymentMethod: "RATTSSKYDD", clientShareBips: 2000 }, 300000);
    const r = await c.billingRun.coverageSplit({ matterId: "m-1", insurerPrutningOre: 50000 });
    expect(r.totalOre).toBe(600000); // 2h × 3000 kr (aktuell taxa)
    expect(r.clientOre).toBe(120000 + 50000); // självrisk 20 % (120000) + prutning 50000
    expect(r.payerOre).toBe(600000 - 170000);
    expect(r.firmLossOre).toBe(0);
  });

  it("rättshjälp: värderar på timkostnadsnormen; dom-prutning → byrå-förlust + klient på reducerat", async () => {
    // 3 tim loggat, varav 1 tim rådgivning (exkl, #809) → 2 effektiva tim × 1626 kr =
    // 325 200 öre bas; dom 300 000 → förlust 25 200; klient 20 % × 300 000.
    const c = caller({ paymentMethod: "RATTSHJALP", clientShareBips: 2000, taxaHasFTax: true }, 999999, 180);
    const r = await c.billingRun.coverageSplit({ matterId: "m-1", awardedOre: 300000 });
    expect(r.totalOre).toBe(325200);
    expect(r.firmLossOre).toBe(25200);
    expect(r.clientOre).toBe(60000);
    expect(r.payerOre).toBe(240000);
  });

  it("rättshjälp: rådgivningstimmen exkluderas ur avgiftsbasen (#809)", async () => {
    // 2 tim loggat, 1 tim rådgivning exkl → bas = 1 effektiv tim × 1626 kr = 162 600.
    const c = caller({ paymentMethod: "RATTSHJALP", clientShareBips: 2000, taxaHasFTax: true }, 999999, 120);
    const r = await c.billingRun.coverageSplit({ matterId: "m-1" });
    expect(r.totalOre).toBe(162600);
  });

  it("returnerar utläggens netto OCH brutto exakt vid BLANDADE momssatser (#849/#850)", async () => {
    // Speglar Carlsson: 7920+22400 @25 % + 1745 @6 %. Netto 32065; brutto =
    // 9900+28000+1850 = 39750 (≠ 32065×1.25=40081 → platt sats vore fel).
    const ds = new DemoDataStore({
      organizations: [{ id: "org-1", name: "X" }],
      matters: [{ id: "m-1", organizationId: "org-1", matterNumber: "2026-0001", title: "T", status: "ACTIVE", responsibleLawyerId: "u-1", paymentMethod: "RATTSSKYDD", clientShareBips: 2000, createdAt: new Date() }],
      users: [{ id: "u-1", organizationId: "org-1", email: "a@x", name: "Anna", role: "ADMIN", hourlyRate: 300000 }],
      timeEntries: [{ id: "te-1", organizationId: "org-1", userId: "u-1", matterId: "m-1", date: new Date(), minutes: 120, description: "M", hourlyRate: 200000, billable: true }],
      expenses: [
        { id: "ex-1", organizationId: "org-1", userId: "u-1", matterId: "m-1", date: new Date(), amount: 7920, description: "Kopiering", billable: true, vatRate: 2500, vatIncluded: false, kind: "EXPENSE" },
        { id: "ex-2", organizationId: "org-1", userId: "u-1", matterId: "m-1", date: new Date(), amount: 22400, description: "Översättning", billable: true, vatRate: 2500, vatIncluded: false, kind: "EXPENSE" },
        { id: "ex-3", organizationId: "org-1", userId: "u-1", matterId: "m-1", date: new Date(), amount: 1745, description: "Taxi", billable: true, vatRate: 600, vatIncluded: false, kind: "EXPENSE" },
      ],
    }, async () => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL }) as any);
    const r = await c.billingRun.coverageSplit({ matterId: "m-1" });
    expect(r.totalOre).toBe(600000); // arvode 2h × 3000 kr
    expect(r.expensesNetOre).toBe(32065);
    expect(r.expensesGrossOre).toBe(39750); // exakt per sats — INTE 40081 (platt 25 %)
  });

  it("KR inskickad (rader frysta) → utläggen räknas ändå (Carlsson-regression, #849)", async () => {
    // Speglar Umgängestvist Carlsson: kostnadsräkningen fryser tid + utlägg.
    // coverageSplit måste läsa de FRYSTA raderna (resolveSettlementWork), annars
    // blir utläggen 0 i slutreglera-dialogen.
    const { caller } = makeCaller({ workMinutes: 120, expenseOre: 90000, paymentMethod: "RATTSHJALP" });
    await caller.billingRun.createKostnadsrakning({ matterId: "m-1" }); // fryser tid + utlägg
    const r = await caller.billingRun.coverageSplit({ matterId: "m-1" });
    expect(r.expensesNetOre).toBe(90000); // frysta utlägg syns fortfarande
  });
});

describe("billingRun.settleCoverage — bokför prutnings-uppdelningen (#801)", () => {
  function caller(matterExtra: Record<string, unknown>, currentRate: number, minutes = 120) {
    const ds = new DemoDataStore({
      organizations: [{ id: "org-1", name: "X" }],
      matters: [{ id: "m-1", organizationId: "org-1", matterNumber: "2026-0001", title: "T", status: "ACTIVE", responsibleLawyerId: "u-1", ...matterExtra, createdAt: new Date() }],
      users: [{ id: "u-1", organizationId: "org-1", email: "a@x", name: "Anna", role: "ADMIN", hourlyRate: currentRate }],
      timeEntries: [{ id: "te-1", organizationId: "org-1", userId: "u-1", matterId: "m-1", date: new Date(), minutes, description: "M", hourlyRate: 200000, billable: true }],
    }, async () => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ds, caller: appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL }) as any) };
  }

  it("rättsskydd: klient = (självrisk + prutning) inkl moms; försäkring = resten; ingen byrå-förlust", async () => {
    const { caller: c } = caller({ paymentMethod: "RATTSSKYDD", clientShareBips: 2000 }, 300000);
    const res = await c.billingRun.settleCoverage({ matterId: "m-1", payerRecipient: "FORSAKRING", insurerPrutningOre: 50000 });
    // total 600000; klient netto 170000 → ×1.25 = 212500; försäkring netto 430000 → 537500.
    expect(res.split).toMatchObject({ clientOre: 170000, payerOre: 430000, firmLossOre: 0 });
    expect(res.clientInvoice.amount).toBe(212500);
    expect(res.payerInvoice.amount).toBe(537500);
  });

  it("rättshjälp: timkostnadsnorm; dom prutar → byrå-förlust bokas (icke-debiterbar PRUTNING), klient på reducerat", async () => {
    // 3 tim loggat − 1 tim rådgivning (#809) = 2 effektiva tim → bas 325 200.
    const { ds, caller: c } = caller({ paymentMethod: "RATTSHJALP", clientShareBips: 2000, taxaHasFTax: true }, 999999, 180);
    const res = await c.billingRun.settleCoverage({ matterId: "m-1", payerRecipient: "RATTSHJALPSMYNDIGHET", awardedOre: 300000 });
    // total 325200; dom 300000 → förlust 25200; klient 60000 → 75000; stat 240000 → 300000.
    expect(res.split).toMatchObject({ clientOre: 60000, payerOre: 240000, firmLossOre: 25200 });
    expect(res.clientInvoice.amount).toBe(75000);
    expect(res.payerInvoice.amount).toBe(300000);
    const prutning = await ds.expenses.findFirst({ where: { matterId: "m-1", kind: "PRUTNING" } }) as { amount: number; billable: boolean };
    expect(prutning.amount).toBe(-25200);
    expect(prutning.billable).toBe(false);
  });

  it("rättshjälp: skickade klient-aconton dras AUTO av från klientfakturan; betalare = DOMSTOL (#856)", async () => {
    const { caller: c } = caller({ paymentMethod: "RATTSHJALP", clientShareBips: 2000, taxaHasFTax: true }, 999999, 180);
    const ac = await c.billingRun.createAcconto({ matterId: "m-1", clientShareBips: 2000, amountOre: 50000 }); // SENT aconto
    const res = await c.billingRun.settleCoverage({ matterId: "m-1", payerRecipient: "DOMSTOL" });
    // Klientens självrisk 20 % × 325 200 = 65 040 netto → ×1,25 = 81 300; minus aconto 50 000 = 31 300.
    expect(res.clientInvoice.amount).toBe(31_300);
    expect(res.clientRun.deductedBillingRunIds).toContain(ac.run.id); // auto-avdraget
    expect(res.payerRun.recipient).toBe("DOMSTOL"); // slutfaktura till domstol
  });

  it("rättshjälp via KR (#828): kräver registrerat beslut; domsbeloppet läses från KR:n; KR konsumeras EJ utan markeras FAKTURERAD", async () => {
    const { ds, caller: c } = caller({ paymentMethod: "RATTSHJALP", clientShareBips: 2000, taxaHasFTax: true }, 999999, 180);
    const kr = await c.billingRun.createKostnadsrakning({ matterId: "m-1" });
    // Faktura före beslut är otillåtet.
    await expect(c.billingRun.settleCoverage({ matterId: "m-1", payerRecipient: "RATTSHJALPSMYNDIGHET" }))
      .rejects.toThrow(/Registrera domstolens beslut/);
    // Registrera domstolens beslut PÅ KR:n (dömt 300 000), sedan fakturera.
    await c.billingRun.recordKostnadsrakningBeslut({ billingRunId: kr.run.id, awardedOre: 300000 });
    const res = await c.billingRun.settleCoverage({ matterId: "m-1", payerRecipient: "RATTSHJALPSMYNDIGHET" });
    // Domsbeloppet (300 000) tas från KR:n → samma split.
    expect(res.split).toMatchObject({ clientOre: 60000, payerOre: 240000, firmLossOre: 25200 });
    expect(res.clientInvoice.amount).toBe(75000);
    expect(res.payerInvoice.amount).toBe(300000);
    // Betalar-körningen är en EGEN FINAL (ej KR:n) → KR:n förblir distinkt.
    expect(res.payerRun.id).not.toBe(kr.run.id);
    const krAfter = await ds.billingRuns.findFirst({ where: { id: kr.run.id } }) as { kostnadsrakningStatus: string; invoiceId: string | null };
    expect(krAfter.kostnadsrakningStatus).toBe("FAKTURERAD");
    expect(krAfter.invoiceId).toBeFalsy(); // KR länkar aldrig till en slutfaktura
  });

  it("rättsskydd tidsuppdelat (#810): arbete före tvist → klient 100 %, retro+efter beslut täckt", async () => {
    const ds = new DemoDataStore({
      organizations: [{ id: "org-1", name: "X" }],
      matters: [{
        id: "m-1", organizationId: "org-1", matterNumber: "2026-0001", title: "T", status: "ACTIVE",
        responsibleLawyerId: "u-1", paymentMethod: "RATTSSKYDD", clientShareBips: 2000,
        tvistUppkomDatum: new Date("2026-03-01"), rattsskyddBeslutDatum: new Date("2026-04-01"), createdAt: new Date(),
      }],
      users: [{ id: "u-1", organizationId: "org-1", email: "a@x", name: "Anna", role: "ADMIN", hourlyRate: 300000 }],
      timeEntries: [
        { id: "te-pre", organizationId: "org-1", userId: "u-1", matterId: "m-1", date: new Date("2026-02-01"), minutes: 120, description: "före tvist", hourlyRate: 200000, billable: true },
        { id: "te-retro", organizationId: "org-1", userId: "u-1", matterId: "m-1", date: new Date("2026-03-15"), minutes: 120, description: "retroaktivt", hourlyRate: 200000, billable: true },
        { id: "te-post", organizationId: "org-1", userId: "u-1", matterId: "m-1", date: new Date("2026-04-15"), minutes: 120, description: "efter beslut", hourlyRate: 200000, billable: true },
      ],
    }, async () => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL }) as any);
    const res = await c.billingRun.settleCoverage({ matterId: "m-1", payerRecipient: "FORSAKRING" });
    // 6 tim × 3000 = 1 800 000 total; täckt 4 tim (retro 2 + efter 2) = 1 200 000.
    // självrisk 20 % × 1 200 000 = 240 000; otäckt (2 tim före tvist) = 600 000.
    expect(res.split).toMatchObject({ clientOre: 840_000, payerOre: 960_000, firmLossOre: 0 });
    expect(res.clientInvoice.amount).toBe(1_050_000); // 840 000 × 1,25 moms
    expect(res.payerInvoice.amount).toBe(1_200_000); // 960 000 × 1,25 moms
  });
});
