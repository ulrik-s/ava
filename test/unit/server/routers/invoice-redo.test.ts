/**
 * "Fel på fakturan?" (#2260) — makulera ett utkast, kreditera och gör om.
 *
 * Körs genom hela `appRouter` mot en riktig in-memory-store, så att släppet av
 * posterna prövas mot samma frågor som Fakturera (`billingRun.proposal`) och
 * slutfakturan (`billingRun.createFinal`) använder.
 */
import { describe, expect, it } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";
import { PAID_REDO_REASON, WRITTEN_OFF_REDO_REASON } from "@/lib/shared/billing/invoice-redo";
import { asId, type InvoiceId } from "@/lib/shared/schemas/ids";

const PRINCIPAL: Principal = {
  id: asId<"UserId">("u-1"), email: "a@x", name: "Anna", role: "ADMIN", organizationId: asId<"OrganizationId">("org-1"),
};
const M = asId<"MatterId">("m-1");

function makeStore(paymentMethod = "PRIVAT", extra: Record<string, unknown[]> = {}): DemoDataStore {
  return new DemoDataStore({
    organizations: [{ id: "org-1", name: "X" }],
    matters: [{
      id: "m-1", organizationId: "org-1", matterNumber: "AA2026-0001", title: "T", status: "ACTIVE",
      responsibleLawyerId: "u-1", createdAt: new Date(), paymentMethod, clientShareBips: 2500,
    }],
    users: [{ id: "u-1", organizationId: "org-1", email: "a@x", name: "Anna", role: "ADMIN", hourlyRates: { ARBETE: 250_000 } }],
    timeEntries: [
      { id: "te-1", organizationId: "org-1", userId: "u-1", matterId: "m-1", date: new Date(), minutes: 120, description: "Möte", hourlyRate: 250_000, billable: true },
      { id: "te-2", organizationId: "org-1", userId: "u-1", matterId: "m-1", date: new Date(), minutes: 30, description: "Internt", hourlyRate: 250_000, billable: false },
    ],
    expenses: [{ id: "ex-1", matterId: "m-1", userId: "u-1", date: new Date(), amount: 50_000, description: "Resa", billable: true, vatRate: 0, vatIncluded: false }],
    invoices: [],
    ...extra,
  }, async () => { /* skrivbar: noop write-back */ });
}

function callerFor(ds: DemoDataStore) {
  return appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL }));
}
type Caller = ReturnType<typeof callerFor>;

function setup(paymentMethod?: string, extra?: Record<string, unknown[]>): { c: Caller; ds: DemoDataStore } {
  const ds = makeStore(paymentMethod, extra);
  return { c: callerFor(ds), ds };
}

/** Postid:n som Fakturera erbjuder just nu. */
async function proposalIds(c: Caller): Promise<string[]> {
  const p = await c.billingRun.proposal({ matterId: M });
  return [...p.timeEntries.map((t) => t.id), ...p.expenses.map((e) => e.id)].sort();
}

/** Låsfälten på en post, direkt ur storen. */
async function lockOf(ds: DemoDataStore, kind: "timeEntries" | "expenses", id: string): Promise<Record<string, unknown>> {
  const row = await ds[kind].findFirst({ where: { id } });
  return { invoiceId: row?.invoiceId ?? null, frozenAt: row?.frozenAt ?? null, frozenByBillingRunId: row?.frozenByBillingRunId ?? null };
}

const RELEASED = { invoiceId: null, frozenAt: null, frozenByBillingRunId: null };

async function noteTexts(c: Caller): Promise<string[]> {
  return (await c.serviceNote.list({ matterId: M })).map((n) => n.text.replace(/\s/g, " "));
}

async function runStatus(c: Caller, invoiceId: InvoiceId): Promise<string | undefined> {
  const { runs } = await c.billingRun.list({ matterId: M });
  return runs.find((r) => r.invoiceId === invoiceId)?.status;
}

describe("makulera ett utkast (#2260)", () => {
  it("utkastet blir annullerat med numret kvar, och posterna kommer tillbaka under Fakturera", async () => {
    const { c, ds } = setup();
    const all = await proposalIds(c);
    const { invoice } = await c.billingRun.createFinal({ matterId: M, recipient: "KLIENT" });
    expect(await proposalIds(c)).toEqual([]);

    const voided = await c.invoice.voidDraft({ invoiceId: invoice.id });
    expect(voided).toMatchObject({ id: invoice.id, status: "CANCELLED", invoiceNumber: invoice.invoiceNumber, amount: invoice.amount });
    expect(await c.invoice.getById({ id: invoice.id })).toMatchObject({ status: "CANCELLED", invoiceNumber: invoice.invoiceNumber });
    expect(await proposalIds(c)).toEqual(all);
    for (const id of ["te-1", "te-2"]) expect(await lockOf(ds, "timeEntries", id)).toEqual(RELEASED);
    expect(await lockOf(ds, "expenses", "ex-1")).toEqual(RELEASED);
    expect(await runStatus(c, invoice.id)).toBe("VOIDED");
    expect(await noteTexts(c)).toContain(`Faktura ${String(invoice.invoiceNumber)} makulerad`);

    // Den nya fakturan får nästa nummer — det makulerade återanvänds aldrig.
    const redo = await c.billingRun.createFinal({ matterId: M, recipient: "KLIENT" });
    expect(redo.invoice.invoiceNumber).not.toBe(invoice.invoiceNumber);
    expect(redo.invoice.amount).toBe(invoice.amount);
  });

  it("ett bokfört utkast makuleras inte — det måste krediteras", async () => {
    const { c } = setup();
    const { invoice } = await c.billingRun.createFinal({ matterId: M, recipient: "KLIENT" });
    await c.invoice.markFortnoxBooked({ invoiceId: invoice.id, fortnoxId: "A/1" });
    await expect(c.invoice.voidDraft({ invoiceId: invoice.id })).rejects.toThrow(/kan inte makuleras/);
    expect((await c.invoice.getById({ id: invoice.id })).status).toBe("DRAFT");
    expect(await proposalIds(c)).toEqual([]);
    // Kreditera och gör om är vägen för det bokförda utkastet.
    const credit = await c.invoice.creditAndRedo({ invoiceId: invoice.id });
    expect(credit).toMatchObject({ invoiceType: "CREDIT", creditedInvoiceId: invoice.id });
  });

  it("setStatus CANCELLED på ett utkast makulerar det — samma släpp som voidDraft", async () => {
    const { c } = setup();
    const all = await proposalIds(c);
    const { invoice } = await c.billingRun.createFinal({ matterId: M, recipient: "KLIENT" });
    expect(await c.invoice.setStatus({ invoiceId: invoice.id, status: "CANCELLED" })).toMatchObject({ status: "CANCELLED" });
    expect(await proposalIds(c)).toEqual(all);
    expect(await noteTexts(c)).toContain(`Faktura ${String(invoice.invoiceNumber)} makulerad`);
  });

  it("en skickad faktura makuleras inte (voidDraft) och annulleras inte via setStatus", async () => {
    const { c } = setup();
    const { invoice } = await c.billingRun.createFinal({ matterId: M, recipient: "KLIENT" });
    await c.invoice.setStatus({ invoiceId: invoice.id, status: "SENT" });
    await expect(c.invoice.voidDraft({ invoiceId: invoice.id })).rejects.toThrow(/krediteras och görs om/);
    await expect(c.invoice.setStatus({ invoiceId: invoice.id, status: "CANCELLED" })).rejects.toThrow(/kreditnota/);
    expect((await c.invoice.getById({ id: invoice.id })).status).toBe("SENT");
  });

  it("okänd faktura → NOT_FOUND", async () => {
    const { c } = setup();
    await expect(c.invoice.voidDraft({ invoiceId: asId<"InvoiceId">("saknas") })).rejects.toThrow(/NOT_FOUND/);
    await expect(c.invoice.creditAndRedo({ invoiceId: asId<"InvoiceId">("saknas") })).rejects.toThrow(/NOT_FOUND/);
  });
});

describe("kreditera och gör om (#2260)", () => {
  it("kreditnota som hänvisar till originalet, originalet annulleras och posterna släpps", async () => {
    const { c, ds } = setup();
    const all = await proposalIds(c);
    const { invoice } = await c.billingRun.createFinal({ matterId: M, recipient: "KLIENT" });
    await c.invoice.setStatus({ invoiceId: invoice.id, status: "SENT" });

    const credit = await c.invoice.creditAndRedo({ invoiceId: invoice.id, notes: "Fel timpris" });
    expect(credit).toMatchObject({ invoiceType: "CREDIT", status: "SENT", amount: -invoice.amount, creditedInvoiceId: invoice.id, notes: "Fel timpris" });
    expect(credit.invoiceNumber).not.toBe(invoice.invoiceNumber);
    const original = await c.invoice.getById({ id: invoice.id });
    expect(original).toMatchObject({ status: "CANCELLED", invoiceNumber: invoice.invoiceNumber });
    expect(original.creditNote).toMatchObject({ id: credit.id });
    expect(await proposalIds(c)).toEqual(all);
    expect(await lockOf(ds, "timeEntries", "te-1")).toEqual(RELEASED);
    expect(await runStatus(c, invoice.id)).toBe("VOIDED");
    expect((await noteTexts(c)).some((t) => t.includes(`krediterar faktura ${String(invoice.invoiceNumber)} för att göras om`))).toBe(true);

    // Den nya, rätta fakturan kan skapas direkt med samma poster.
    const redo = await c.billingRun.createFinal({ matterId: M, recipient: "KLIENT", timeEntryIds: [asId("te-1")], expenseIds: [asId("ex-1")] });
    expect(redo.invoice.amount).toBe(invoice.amount);
  });

  it("en avbetalningsplan avbryts och fakturan krediteras", async () => {
    const { c } = setup();
    const { invoice } = await c.billingRun.createFinal({ matterId: M, recipient: "KLIENT" });
    await c.invoice.setStatus({ invoiceId: invoice.id, status: "SENT" });
    const plan = await c.invoice.createPaymentPlan({ invoiceId: invoice.id, monthlyAmount: 10_000, dayOfMonth: 25, startDate: "2026-12-25" });
    await c.invoice.creditAndRedo({ invoiceId: invoice.id });
    expect((await c.paymentPlan.getById({ id: plan.id })).status).toBe("CANCELLED");
    expect((await c.invoice.getById({ id: invoice.id })).status).toBe("CANCELLED");
  });

  it("ett obokfört utkast krediteras inte — det makuleras", async () => {
    const { c } = setup();
    const { invoice } = await c.billingRun.createFinal({ matterId: M, recipient: "KLIENT" });
    await expect(c.invoice.creditAndRedo({ invoiceId: invoice.id })).rejects.toThrow(/makuleras i stället/);
  });

  it("en betald faktura görs inte om: betalningen ligger kvar och reskontran kan inte visa ett tillgodo", async () => {
    const { c } = setup();
    const { invoice } = await c.billingRun.createFinal({ matterId: M, recipient: "KLIENT" });
    await c.invoice.recordPayment({ invoiceId: invoice.id, amount: invoice.amount, paidAt: "2026-11-20" });
    expect((await c.invoice.getById({ id: invoice.id })).status).toBe("PAID");
    await expect(c.invoice.creditAndRedo({ invoiceId: invoice.id })).rejects.toThrow(PAID_REDO_REASON.slice(0, 40));
    expect((await c.invoice.getById({ id: invoice.id })).status).toBe("PAID");
    expect(await proposalIds(c)).toEqual([]);
  });

  it("en delbetald faktura görs inte om", async () => {
    const { c } = setup();
    const { invoice } = await c.billingRun.createFinal({ matterId: M, recipient: "KLIENT" });
    await c.invoice.recordPayment({ invoiceId: invoice.id, amount: 1_000, paidAt: "2026-11-20" });
    await expect(c.invoice.creditAndRedo({ invoiceId: invoice.id })).rejects.toThrow(/inbetalningar/);
  });

  it("en avskriven faktura görs inte om", async () => {
    const { c } = setup();
    const { invoice } = await c.billingRun.createFinal({ matterId: M, recipient: "KLIENT" });
    await c.invoice.setStatus({ invoiceId: invoice.id, status: "SENT" });
    await c.invoice.writeOff({ invoiceId: invoice.id, amount: 1_000 });
    await expect(c.invoice.creditAndRedo({ invoiceId: invoice.id })).rejects.toThrow(WRITTEN_OFF_REDO_REASON);
  });

  it("en redan krediterad faktura och en kreditfaktura görs inte om", async () => {
    const { c } = setup();
    const { invoice } = await c.billingRun.createFinal({ matterId: M, recipient: "KLIENT" });
    await c.invoice.setStatus({ invoiceId: invoice.id, status: "SENT" });
    const credit = await c.invoice.creditAndRedo({ invoiceId: invoice.id });
    await expect(c.invoice.creditAndRedo({ invoiceId: invoice.id })).rejects.toThrow(/redan annullerad eller krediterad/);
    await expect(c.invoice.creditAndRedo({ invoiceId: credit.id })).rejects.toThrow(/kreditfaktura kan inte göras om/);
  });

  it("rådgivningstimmens faktura görs inte om", async () => {
    const { c } = setup("RATTSHJALP");
    const { invoice } = await c.invoice.createRadgivning({ matterId: M });
    await expect(c.invoice.voidDraft({ invoiceId: invoice.id })).rejects.toThrow(/Rådgivningstimmens faktura/);
  });

  it("en faktura som en kostnadsräkning pekar på görs inte om", async () => {
    const { c } = setup("OFFENTLIGT_UPPDRAG", {
      invoices: [{ id: "inv-kr", matterId: "m-1", invoiceNumber: "F-2026-0100", amount: 100_000, invoiceType: "FINAL", status: "DRAFT", invoiceDate: new Date() }],
      billingRuns: [{
        id: "run-kr", matterId: "m-1", type: "KOSTNADSRAKNING", recipient: "DOMSTOL", status: "SENT", workValueOreAtRun: 100_000,
        proposedAmountOre: 100_000, amountOre: 100_000, invoiceId: "inv-kr", deductedBillingRunIds: [], periodTo: new Date(),
      }],
    });
    await expect(c.invoice.voidDraft({ invoiceId: asId<"InvoiceId">("inv-kr") })).rejects.toThrow(/kostnadsräkning/);
    expect((await c.billingRun.byId({ id: asId("run-kr") })).status).toBe("SENT");
  });
});

describe("aconto-avdrag och ärendets fas (#2260)", () => {
  it("en omgjord slutfaktura släpper sina aconto-avdrag; acontot kan dras av igen", async () => {
    const { c } = setup();
    const aconto = await c.billingRun.createAcconto({ matterId: M, clientShareBips: 2500, amountOre: 20_000 });
    await c.invoice.setStatus({ invoiceId: aconto.invoice.id, status: "SENT" });
    const final = await c.billingRun.createFinal({ matterId: M, recipient: "KLIENT", deductedBillingRunIds: [aconto.run.id] });
    expect((await c.invoice.getById({ id: aconto.invoice.id })).deductedOnFinals).toHaveLength(1);

    // Acontot är avräknat på en levande slutfaktura → slutfakturan görs om först.
    await expect(c.invoice.creditAndRedo({ invoiceId: aconto.invoice.id })).rejects.toThrow(new RegExp(`slutfaktura ${String(final.invoice.invoiceNumber)}`));

    await c.invoice.voidDraft({ invoiceId: final.invoice.id });
    expect(await runStatus(c, final.invoice.id)).toBe("VOIDED");
    expect(await runStatus(c, aconto.invoice.id)).toBe("SENT");
    const redo = await c.billingRun.createFinal({ matterId: M, recipient: "KLIENT", deductedBillingRunIds: [aconto.run.id] });
    expect(redo.invoice.amount).toBe(final.invoice.amount);

    // Med slutfakturan annullerad (och den nya makulerad) kan acontot självt göras om.
    await c.invoice.voidDraft({ invoiceId: redo.invoice.id });
    await c.invoice.creditAndRedo({ invoiceId: aconto.invoice.id });
    expect(await runStatus(c, aconto.invoice.id)).toBe("VOIDED");
    expect((await c.billingRun.proposal({ matterId: M })).priorAccontoSumOre).toBe(0);
  });

  it("rättsskydd: en omgjord faktura till försäkringen lämnar fasen slutreglerad, så en ny kan skapas", async () => {
    const { c } = setup("RATTSSKYDD");
    const { invoice } = await c.billingRun.createFinal({ matterId: M, recipient: "FORSAKRING" });
    await expect(c.billingRun.createFinal({ matterId: M, recipient: "FORSAKRING" })).rejects.toThrow(/SLUTREGLERAD/);
    await c.invoice.setStatus({ invoiceId: invoice.id, status: "SENT" });
    await c.invoice.creditAndRedo({ invoiceId: invoice.id });
    const redo = await c.billingRun.createFinal({ matterId: M, recipient: "FORSAKRING" });
    expect(redo.invoice.amount).toBe(invoice.amount);
  });

  it("vanlig kreditering (createCredit) är oförändrad: posterna står kvar på originalet", async () => {
    const { c, ds } = setup();
    const { invoice } = await c.billingRun.createFinal({ matterId: M, recipient: "KLIENT" });
    await c.invoice.setStatus({ invoiceId: invoice.id, status: "SENT" });
    await c.invoice.createCredit({ invoiceId: invoice.id });
    expect(await lockOf(ds, "timeEntries", "te-1")).toMatchObject({ invoiceId: invoice.id });
    expect(await runStatus(c, invoice.id)).toBe("SENT");
  });
});
