/**
 * Kronologisk scenario-runner (#880): spelar upp ett ärendes SimEvent[] i tidsordning
 * via tRPC-callern. Här testas runnern mot en INSPELNINGS-STUB (ingen riktig backend)
 * — verifierar ordning, härledda aconto-belopp och att inkommande dok får direction.
 */

import { describe, it, expect } from "vitest-compat";
import type { SimMatter } from "../../tooling/demo-generator/simulate/events";
import { emptyRunResult, runScenario, type RunCtx } from "../../tooling/demo-generator/simulate/runner";
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
    if (method === "invoice.createPaymentPlan") return { id: "plan-1" };
    if (method === "document.tree") return { folders: [], documents: [] };
    if (method === "document.suggestFromText") return { parties: 0, events: 0 };
    // −1: raden är redan pushad ovan, så id:na blir 0-baserade i anropsordning.
    if (method === "document.createFolder") return { id: `folder-${calls.filter((c) => c.method === "document.createFolder").length - 1}` };
    if (method === "billingRun.settleCoverage") return { creditInvoice: { id: "cred", amount: -50_000 }, clientInvoice: {}, payerInvoice: {} };
    return {};
  };
  const c = {
    matter: { addContact: rec("matter.addContact") },
    timeEntry: { create: rec("timeEntry.create") },
    serviceNote: { create: rec("serviceNote.create") },
    expense: { create: rec("expense.create") },
    document: { register: rec("document.register"), createFolder: rec("document.createFolder"), tree: rec("document.tree"), suggestFromText: rec("document.suggestFromText") },
    invoiceDispatch: { recordManual: rec("invoiceDispatch.recordManual") },
    invoice: {
      createRadgivning: rec("invoice.createRadgivning"), setStatus: rec("invoice.setStatus"),
      recordPayment: rec("invoice.recordPayment"), createPaymentPlan: rec("invoice.createPaymentPlan"),
      cancelPaymentPlan: rec("invoice.cancelPaymentPlan"), writeOff: rec("invoice.writeOff"),
    },
    paymentPlan: { recordReminder: rec("paymentPlan.recordReminder") },
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
    const ctx: RunCtx = { c, res: emptyRunResult() };
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

    // Tre aconton vid varierande satser (5/40/5 %), belopp härlett ur upparbetat.
    const accontos = calls.filter((x) => x.method === "billingRun.createAcconto");
    expect(accontos.map((a) => a.args.clientShareBips)).toEqual([500, 4000, 500]);
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
    const ctx: RunCtx = { c, accontoThresholdOre: 50_000_000, res: emptyRunResult() };
    const events = buildRattshjalpScenario({ motpart: "c-mot", motpartsombud: "c-omb", domstol: "c-dom" });
    await runScenario(ctx, MATTER, events);
    expect(calls.filter((x) => x.method === "billingRun.createAcconto")).toHaveLength(0);
    // Rådgivning + kostnadsräkning + slutreglering körs fortfarande.
    expect(calls.some((x) => x.method === "invoice.createRadgivning")).toBe(true);
    expect(calls.some((x) => x.method === "billingRun.settleCoverage")).toBe(true);
  });
});

/**
 * Fakturans livscykler (#982). De låg i `populate-billing.ts` och slutade köras
 * när simuleringen tog över (#880) — `/payment-plans` stod tom i demon och
 * avskrivningsvägen visades aldrig. Testerna nedan vaktar de tre plan-tillstånden
 * och kundförlusten var för sig, mot inspelningsstubben.
 */
describe("fakturans livscykler i simuleringen (#982)", () => {
  const PRIVAT: SimMatter = { id: "m-p", paymentMethod: "PRIVAT", lawyerId: "u-1", startDaysAgo: 300, arvodeRateOre: 250_000 };

  /** Kör bara `final` + de livscykel-event testet gäller. */
  async function run(events: Any[]) {
    const { c, calls } = recordingCaller();
    const ctx: RunCtx = { c, res: emptyRunResult() };
    await runScenario(ctx, PRIVAT, [{ kind: "final", dayOffset: 0, recipient: "KLIENT" }, ...events]);
    return { calls, ctx };
  }

  it("ACTIVE-plan: månadsbeloppet härleds ur fakturan och delbetalningarna dateras framåt", async () => {
    const { calls, ctx } = await run([{ kind: "paymentPlan", dayOffset: 1, installments: 5, paidInstallments: 2, reminders: 2 }]);

    const plan = calls.find((x) => x.method === "invoice.createPaymentPlan")!;
    expect(plan.args.invoiceId).toBe("fin");
    expect(plan.args.monthlyAmount).toBe(20_000); // 100 000 / 5
    expect(ctx.res.paymentPlans).toBe(1);

    // Två påminnelser, i månadsformat, och två delbetalningar — inte fler.
    const reminders = calls.filter((x) => x.method === "paymentPlan.recordReminder");
    expect(reminders).toHaveLength(2);
    expect(reminders.every((r) => /^\d{4}-\d{2}$/.test(String(r.args.dueMonth)))).toBe(true);
    const pays = calls.filter((x) => x.method === "invoice.recordPayment");
    expect(pays.map((p) => p.args.amount)).toEqual([20_000, 20_000]);
    // Planen lämnas ACTIVE: varken avbruten eller fullbetald.
    expect(calls.some((x) => x.method === "invoice.cancelPaymentPlan")).toBe(false);
  });

  it("COMPLETED-plan: summan av delbetalningarna är EXAKT fakturabeloppet", async () => {
    // 100 000 / 3 avrundas UPP till 33 334 — tre sådana blir 100 002, vilket
    // routerns partitionsvakt (ADR 0007) avvisar. Sista posten måste kapas.
    const { calls } = await run([{ kind: "paymentPlan", dayOffset: 1, installments: 3, paidInstallments: 3 }]);
    const amounts = calls.filter((x) => x.method === "invoice.recordPayment").map((p) => Number(p.args.amount));
    expect(amounts).toEqual([33_334, 33_334, 33_332]);
    expect(amounts.reduce((s, a) => s + a, 0)).toBe(100_000);
  });

  it("CANCELLED-plan: avbryts EFTER inbetalningarna, så gjorda betalningar ligger kvar", async () => {
    const { calls } = await run([{ kind: "paymentPlan", dayOffset: 1, installments: 6, paidInstallments: 1, cancel: true }]);
    const payIdx = calls.findIndex((x) => x.method === "invoice.recordPayment");
    const cancelIdx = calls.findIndex((x) => x.method === "invoice.cancelPaymentPlan");
    expect(payIdx).toBeGreaterThanOrEqual(0);
    expect(cancelIdx).toBeGreaterThan(payIdx);
    expect(calls[cancelIdx]!.args.planId).toBe("plan-1");
  });

  it("kundförlust: delbetalning först, sedan avskrivning UTAN belopp (routern räknar återstoden)", async () => {
    const { calls, ctx } = await run([{ kind: "writeOff", dayOffset: 1, partialBips: 2500 }]);
    const pay = calls.find((x) => x.method === "invoice.recordPayment")!;
    expect(pay.args.amount).toBe(25_000); // 25 % av 100 000
    const wo = calls.find((x) => x.method === "invoice.writeOff")!;
    expect(wo.args.invoiceId).toBe("fin");
    // Inget `amount`: återstoden härleds ur ledgern, så simuleringen inte
    // duplicerar den matematiken (och inte kan komma ur synk med den).
    expect(wo.args.amount).toBeUndefined();
    expect(ctx.res.writeOffs).toBe(1);
  });

  it("utan slutfaktura händer ingenting — inga anrop mot en faktura som inte finns", async () => {
    const { c, calls } = recordingCaller();
    const ctx: RunCtx = { c, res: emptyRunResult() };
    await runScenario(ctx, PRIVAT, [
      { kind: "paymentPlan", dayOffset: 1, installments: 3, paidInstallments: 1 },
      { kind: "writeOff", dayOffset: 2 },
    ]);
    expect(calls).toHaveLength(0);
    expect(ctx.res.paymentPlans).toBe(0);
    expect(ctx.res.writeOffs).toBe(0);
  });
});

/**
 * Dokumentmappar och utskickshistorik (#985). Båda entiteterna tappades tyst av
 * demons loader, men bakom den bristen låg en till: simuleringen skapade dem
 * aldrig. Varje dokument låg i roten — träd-vyns mapphantering gick varken att
 * se eller prova — och fakturans utskickshistorik var tom oavsett hur många
 * fakturor som skickats.
 */
describe("mappar + utskick i simuleringen (#985)", () => {
  const PRIVAT: SimMatter = {
    id: "m-p", paymentMethod: "PRIVAT", lawyerId: "u-1", startDaysAgo: 300,
    arvodeRateOre: 250_000, clientEmail: "klient@example.se",
  };

  async function run(events: Any[], matter: SimMatter = PRIVAT) {
    const { c, calls } = recordingCaller();
    const ctx: RunCtx = { c, res: emptyRunResult() };
    await runScenario(ctx, matter, events);
    return { calls, ctx };
  }

  it("dokument filas i mottagarens mapp — och mappen skapas EN gång", async () => {
    const { calls, ctx } = await run([
      { kind: "doc", dayOffset: 0, template: "stamningsansokan" }, // DOMSTOL
      { kind: "doc", dayOffset: 1, template: "inlaga" },           // DOMSTOL igen
      { kind: "doc", dayOffset: 2, template: "brevTillOmbud" },    // MOTPART
    ]);

    const folders = calls.filter((x) => x.method === "document.createFolder");
    // Två domstolsdokument → EN "Domstol"-mapp, inte två.
    expect(folders.map((f) => f.args.name)).toEqual(["Domstol", "Korrespondens"]);
    expect(ctx.res.folders).toBe(2);

    const regs = calls.filter((x) => x.method === "document.register");
    expect(regs[0]!.args.folderId).toBe(regs[1]!.args.folderId); // samma mapp
    expect(regs[2]!.args.folderId).not.toBe(regs[0]!.args.folderId);
    expect(regs.every((r) => r.args.folderId !== null)).toBe(true);
  });

  it("nästlade mappar skapas uppifrån och ned, med rätt förälder", async () => {
    // `dom` har subFolder "Domar" → Domstol/Domar. Utan nästling hade demon
    // sett ut som att träd-vyn bara klarar en nivå.
    const { calls } = await run([{ kind: "doc", dayOffset: 0, template: "dom" }]);
    const folders = calls.filter((x) => x.method === "document.createFolder");
    expect(folders.map((f) => f.args.name)).toEqual(["Domstol", "Domar"]);
    expect(folders[0]!.args.parentId).toBeNull();
    expect(folders[1]!.args.parentId).toBe("folder-0"); // barnet pekar på föräldern
  });

  it("slutfaktura till klienten registreras som utskick till klientens e-post", async () => {
    const { calls, ctx } = await run([{ kind: "final", dayOffset: 0, recipient: "KLIENT" }]);
    const dispatch = calls.find((x) => x.method === "invoiceDispatch.recordManual");
    expect(dispatch?.args).toMatchObject({ invoiceId: "fin", channel: "email", recipient: "klient@example.se" });
    expect(ctx.res.dispatches).toBe(1);
  });

  it("utan klient-e-post registreras inget utskick — hellre tomt än påhittat", async () => {
    const { calls, ctx } = await run(
      [{ kind: "final", dayOffset: 0, recipient: "KLIENT" }],
      { ...PRIVAT, clientEmail: undefined },
    );
    expect(calls.filter((x) => x.method === "invoiceDispatch.recordManual")).toHaveLength(0);
    expect(ctx.res.dispatches).toBe(0);
  });

  it("fakturor till DOMSTOL får inget klient-utskick", async () => {
    const { calls } = await run([{ kind: "final", dayOffset: 0, recipient: "DOMSTOL" }]);
    expect(calls.filter((x) => x.method === "invoiceDispatch.recordManual")).toHaveLength(0);
  });
});
