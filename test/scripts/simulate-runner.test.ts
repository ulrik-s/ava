/**
 * Kronologisk scenario-runner (#880): spelar upp ett ärendes SimEvent[] i tidsordning
 * via tRPC-callern. Här testas runnern mot en INSPELNINGS-STUB (ingen riktig backend)
 * — verifierar ordning, härledda aconto-belopp och att inkommande dok får direction.
 */

import { describe, it, expect } from "vitest-compat";
import type { SimMatter } from "../../tooling/demo-generator/simulate/events";
import { runScenario, type RunCtx } from "../../tooling/demo-generator/simulate/runner";
import { buildRattshjalpScenario } from "../../tooling/demo-generator/simulate/scenarios/rattshjalp";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** Bygg en caller-stub som spelar in varje mutation + returnerar minsta rimliga svar. */
function recordingCaller() {
  const calls: Array<{ method: string; args: Any }> = [];
  const rec = (method: string) => async (args: Any) => {
    calls.push({ method, args });
    if (method === "billingRun.createAcconto") return { run: { id: "run" }, invoice: { id: `inv-${calls.length}` } };
    if (method === "billingRun.createKostnadsrakning") return { run: { id: "kr", workValueOreAtRun: 1_544_700 } };
    if (method === "billingRun.createFinal") return { invoice: { id: "fin", amount: 100_000 } };
    if (method === "billingRun.settleCoverage") return { creditInvoice: { id: "cred", amount: -50_000 }, clientInvoice: {}, payerInvoice: {} };
    return {};
  };
  const c = {
    matter: { addContact: rec("matter.addContact") },
    timeEntry: { create: rec("timeEntry.create") },
    serviceNote: { create: rec("serviceNote.create") },
    expense: { create: rec("expense.create") },
    document: { register: rec("document.register") },
    invoice: { createRadgivning: rec("invoice.createRadgivning"), setStatus: rec("invoice.setStatus"), recordPayment: rec("invoice.recordPayment") },
    billingRun: {
      createAcconto: rec("billingRun.createAcconto"), createKostnadsrakning: rec("billingRun.createKostnadsrakning"),
      recordKostnadsrakningBeslut: rec("billingRun.recordKostnadsrakningBeslut"), settleCoverage: rec("billingRun.settleCoverage"),
      createFinal: rec("billingRun.createFinal"),
    },
  };
  return { c, calls };
}

const MATTER: SimMatter = {
  id: "m-1", paymentMethod: "RATTSHJALP", clientShareBips: 500, lawyerId: "u-1",
  startDaysAgo: 120, arvodeRateOre: 162_600,
};

describe("runScenario (#880)", () => {
  it("spelar upp rättshjälps-scenariot kronologiskt med härledda aconto-belopp", async () => {
    const { c, calls } = recordingCaller();
    const ctx: RunCtx = { c, res: { invoices: 0, documents: 0, timeEntries: 0, notes: 0, credits: 0 } };
    const events = buildRattshjalpScenario({ klient: "c-klient", motpart: "c-mot", motpartsombud: "c-omb", domstol: "c-dom" });
    await runScenario(ctx, MATTER, events);

    // Klienten länkas som KLIENT-kontakt (#886-följd: klient saknades tidigare).
    const klientLink = calls.find((x) => x.method === "matter.addContact" && x.args.role === "KLIENT");
    expect(klientLink?.args.contactId).toBe("c-klient");

    // Kronologi: varje mutations datum-arg (date/invoiceDate/createdAt) är icke-avtagande.
    const dates = calls.map((x) => x.args.date ?? x.args.invoiceDate ?? x.args.createdAt).filter(Boolean).map((d: string) => new Date(d).getTime());
    for (let i = 1; i < dates.length; i++) expect(dates[i]).toBeGreaterThanOrEqual(dates[i - 1]!);

    // Rådgivning skapas FÖRE första acontot.
    const radIdx = calls.findIndex((x) => x.method === "invoice.createRadgivning");
    const firstAcc = calls.findIndex((x) => x.method === "billingRun.createAcconto");
    expect(radIdx).toBeGreaterThanOrEqual(0);
    expect(radIdx).toBeLessThan(firstAcc);
    // #880: rådgivningen faktureras SAMMA DAG (invoiceDate satt) + som egen tidspost.
    const rad = calls[radIdx]!;
    expect(rad.args.invoiceDate).toBeTruthy();
    const radTime = calls.find((x) => x.method === "timeEntry.create" && String(x.args.description).includes("Rådgivning"));
    expect(radTime?.args.date).toBe(rad.args.invoiceDate); // samma dag som mötet

    // Tre aconton vid varierande satser (5/75/5 %), belopp härlett ur upparbetat.
    const accontos = calls.filter((x) => x.method === "billingRun.createAcconto");
    expect(accontos.map((a) => a.args.clientShareBips)).toEqual([500, 7500, 500]);
    expect(accontos.every((a) => a.args.amountOre > 0)).toBe(true);
    // #885: aconto skickas FÖRST när klientens ackumulerade andel nått tröskeln
    // (default 150000 öre) — varje acontos klient-andel-rad ligger på/över den.
    const clientNet = (a: Any): number =>
      a.args.settlementBreakdown.rows.find((r: Any) => r.label.includes("Klientens andel"))?.amountOre ?? 0;
    expect(accontos.every((a) => clientNet(a) >= 150_000)).toBe(true);
    // #880: varje aconto bär tidsspecen för det upparbetade arbetet (klienten ser vad hen betalar för).
    expect(accontos.every((a) => (a.args.settlementBreakdown?.timeLines?.length ?? 0) > 0)).toBe(true);
    expect(accontos.every((a) => a.args.settlementBreakdown.rows.some((r: Any) => r.label.includes("Upparbetat arbete")))).toBe(true);

    // Inkommande svaromål registreras med direction INKOMMANDE.
    const svaromal = calls.find((x) => x.method === "document.register" && x.args.documentType === "Svaromål");
    expect(svaromal?.args.direction).toBe("INKOMMANDE");
    // Utgående inlaga med direction UTGAENDE.
    const inlaga = calls.find((x) => x.method === "document.register" && x.args.documentType === "Inlaga");
    expect(inlaga?.args.direction).toBe("UTGAENDE");

    // Avslutas med kostnadsräkning → beslut → slutreglering.
    expect(calls.some((x) => x.method === "billingRun.createKostnadsrakning")).toBe(true);
    expect(calls.some((x) => x.method === "billingRun.recordKostnadsrakningBeslut")).toBe(true);
    expect(calls.some((x) => x.method === "billingRun.settleCoverage")).toBe(true);
    expect(ctx.res.credits).toBe(1);
  });

  it("skickar INGA aconton om byråns gränsbelopp ligger över det upparbetade (#885)", async () => {
    const { c, calls } = recordingCaller();
    // Gränsbelopp långt över klientens totala andel → tröskeln nås aldrig.
    const ctx: RunCtx = { c, accontoThresholdOre: 50_000_000, res: { invoices: 0, documents: 0, timeEntries: 0, notes: 0, credits: 0 } };
    const events = buildRattshjalpScenario({ motpart: "c-mot", motpartsombud: "c-omb", domstol: "c-dom" });
    await runScenario(ctx, MATTER, events);
    expect(calls.filter((x) => x.method === "billingRun.createAcconto")).toHaveLength(0);
    // Rådgivning + kostnadsräkning + slutreglering körs fortfarande.
    expect(calls.some((x) => x.method === "invoice.createRadgivning")).toBe(true);
    expect(calls.some((x) => x.method === "billingRun.settleCoverage")).toBe(true);
  });
});
