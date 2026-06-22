/**
 * Scenario-test: civilmål (bostadsrättstvist) på löpande räkning
 * ============================================================
 *
 * Privatklienten ringer Anna Advokat: hen är medlem i en bostadsrätts-
 * förening som debiterat felaktiga avgifter. Anna åtar sig ärendet på
 * LÖPANDE RÄKNING (inte taxa — det är ett civilmål utan offentlig
 * försvarare). Hennes timtaxa: 2 500 kr/h exkl moms.
 *
 * Flöde (typisk svensk civilprocess för konsumenträtt/bostadsrätt):
 *
 *   1.  Klienten ringer → jävskontroll mot BRF:n + dess företrädare
 *   2.  Anna skapar ärendet (isTaxeArende=false, payment=PRIVAT)
 *   3.  Inledande klientmöte (90 min)
 *   4.  Granskning föreningsstämmoprotokoll + årsredovisning (120 min)
 *   5.  Kontakt med BRF:s advokat — förhandling per telefon (60 min)
 *   6.  Förlikningsförhandling — fysiskt möte (180 min) + reseutlägg
 *   7.  ACCONTO-faktura skickas till klienten
 *   8.  Klienten betalar acconto i sin helhet
 *   9.  Stämningsansökan författas (240 min)
 *   10. Förberedande sammanträde i TR (75 min)
 *   11. Slutförhandling / förlikning (120 min)
 *   12. SLUTFAKTURA — alla unbilled timmar + utlägg − acconto
 *   13. Klienten betalar slutfakturan i sin helhet
 *
 * Beräkningar verifieras vid varje steg: brutto-belopp = sum(minuter ×
 * timtaxa / 60), utlägg-summor, acconto-avdrag, netto-belopp, status-
 * transitioner.
 */

import { describe, it, expect, beforeAll } from "vitest-compat";
import { buildGitPorts } from "@/lib/server/adapters/git-ports";
import { DemoDataStore, type DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { appRouter } from "@/lib/server/routers/_app";
import { prebakeJoins } from "@/lib/shared/demo-source";
import { computeFinalInvoiceBreakdown } from "@/lib/shared/invoice-calc";

const ORG_ID = "firma-ab";
const HOURLY_RATE = 250_000; // 2 500 kr/h exkl moms (i öre)
const ADMIN_USER = {
  id: "u-anna", email: "anna@firma.local", name: "Anna Advokat",
  role: "ADMIN" as const, organizationId: ORG_ID,
};

function makeStore(): { caller: ReturnType<typeof appRouter.createCaller>; source: DemoSource } {
  const source: DemoSource = prebakeJoins({
    organizations: [{ id: ORG_ID, name: "Anna Advokat AB", orgNumber: "556677-8899" }],
    users: [{ ...ADMIN_USER, hourlyRate: HOURLY_RATE, mileageRate: 250, title: "Senior partner" }],
    contacts: [], matters: [], matterContacts: [],
    documents: [], timeEntries: [], expenses: [],
    invoices: [], calendarEvents: [], tasks: [],
    documentTemplates: [], conflictChecks: [], offices: [],
    paymentPlans: [], paymentPlanReminders: [], payments: [],
  } as DemoSource);
  const dataStore = new DemoDataStore(source, async () => { /* no-op */ });
  const ports = buildGitPorts(dataStore);
  const caller = appRouter.createCaller({
    user: ADMIN_USER, dataStore, ports, repos: buildInMemoryRepositories(dataStore),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  return { caller, source };
}

// ─── Konkreta tider (deterministiska) ────────────────────────────────
const D = {
  call: new Date("2026-03-02T10:00:00Z"),
  meeting1: new Date("2026-03-05T13:00:00Z"),
  granskning: new Date("2026-03-10T09:00:00Z"),
  motpartCall: new Date("2026-03-17T14:30:00Z"),
  forlikningMote: new Date("2026-03-25T13:00:00Z"),
  accontoDate: new Date("2026-04-01T09:00:00Z"),
  accontoPaid: new Date("2026-04-15T10:00:00Z"),
  stamning: new Date("2026-05-10T11:00:00Z"),
  forberedande: new Date("2026-06-08T10:00:00Z"),
  forlikningTR: new Date("2026-07-15T09:00:00Z"),
  slutfaktura: new Date("2026-07-20T10:00:00Z"),
  slutPayment: new Date("2026-08-10T14:00:00Z"),
};

interface State {
  caller: ReturnType<typeof appRouter.createCaller>;
  source: DemoSource;
  klientId?: string;
  brfId?: string;
  brfOmbudId?: string;
  domstolId?: string;
  matterId?: string;
  accontoInvoiceId?: string;
  accontoRunId?: string;
  finalInvoiceId?: string;
}
const state: State = {} as State;

beforeAll(() => {
  const s = makeStore();
  state.caller = s.caller;
  state.source = s.source;
});

describe("Scenario: civilmål (bostadsrättstvist) på löpande räkning", () => {
  // ─── 1. Klienten ringer + jävskontroll ───────────────────────────
  it("1. Klienten ringer — Anna lägger upp parterna och kör jävskontroll", async () => {
    const klient = await state.caller.contacts.create({
      name: "Erik Eriksson", contactType: "PERSON",
      personalNumber: "19720315-4567",
      notes: "Medlem i BRF Stenen. Misstänker felaktig avgiftsdebitering.",
    });
    state.klientId = klient.id;

    const brf = await state.caller.contacts.create({
      name: "BRF Stenen", contactType: "COMPANY",
      orgNumber: "769605-1234",
      notes: "Motpart i ärendet.",
    });
    state.brfId = brf.id;

    const ombud = await state.caller.contacts.create({
      name: "Advokatbyrån Skär & Söner", contactType: "LAW_FIRM",
      orgNumber: "556012-3456",
    });
    state.brfOmbudId = ombud.id;

    const tr = await state.caller.contacts.create({
      name: "Stockholms tingsrätt", contactType: "COURT",
      orgNumber: "202100-2742",
    });
    state.domstolId = tr.id;

    // Jävskontroll — Anna har aldrig haft BRF Stenen eller dess ombud
    // som klient. Bekräftar att inga träffar finns.
    const checkBrf = await state.caller.conflict.check({
      searchTerm: "BRF Stenen", searchType: "name",
    });
    expect(checkBrf.matchCount).toBe(0);
    const checkOmbud = await state.caller.conflict.check({
      searchTerm: "Skär", searchType: "name",
    });
    expect(checkOmbud.matchCount).toBe(0);
  });

  // ─── 2. Skapa ärendet ────────────────────────────────────────────
  it("2. Anna skapar ärendet — isTaxeArende=false, payment=PRIVAT", async () => {
    const matter = await state.caller.matter.create({
      title: "Erik Eriksson ./. BRF Stenen — felaktig avgiftsdebitering",
      description: "Tvist om årsavgift 2024–2025. Yrkat belopp ca 45 000 kr återbetalning.",
      matterType: "Bostadsrätt",
      klientId: state.klientId!,
      isTaxeArende: false,
    });
    expect(matter.isTaxeArende).toBe(false);
    state.matterId = matter.id;

    // Betalningsmetod = PRIVAT (klient betalar direkt)
    const upd = await state.caller.matter.update({
      id: matter.id, paymentMethod: "PRIVAT",
    });
    expect(upd.paymentMethod).toBe("PRIVAT");

    // Koppla parter
    for (const [contactId, role] of [
      [state.brfId!, "MOTPART"],
      [state.brfOmbudId!, "MOTPARTSOMBUD"],
      [state.domstolId!, "DOMSTOL"],
    ] as const) {
      await state.caller.matter.addContact({ matterId: matter.id, contactId, role });
    }
    const m = await state.caller.matter.getById({ id: matter.id });
    expect(m.contacts.length).toBe(4); // klient + 3 ovan
  });

  // ─── 3. Inledande klientmöte ─────────────────────────────────────
  it("3. Inledande klientmöte (90 min)", async () => {
    const te = await state.caller.timeEntry.create({
      matterId: state.matterId!,
      date: D.meeting1.toISOString().slice(0, 10),
      minutes: 90,
      description: "Inledande klientmöte — genomgång av ärende och underlag",
      billable: true,
    });
    expect(te.minutes).toBe(90);
    // 90 min × 250 000 öre/h ÷ 60 = 375 000 öre = 3 750 kr
    const expectedAmount = Math.round((90 * HOURLY_RATE) / 60);
    expect(expectedAmount).toBe(375_000);
  });

  // ─── 4. Granskning av föreningsdokument ──────────────────────────
  it("4. Granskning föreningsstämmoprotokoll + årsredovisning (120 min)", async () => {
    await state.caller.timeEntry.create({
      matterId: state.matterId!,
      date: D.granskning.toISOString().slice(0, 10),
      minutes: 120,
      description: "Granskning föreningsstämmoprotokoll 2024-2025 + årsredovisning",
      billable: true,
    });
  });

  // ─── 5. Telefonsamtal med motpartens ombud ───────────────────────
  it("5. Telefonkontakt med BRF:s ombud — 60 min", async () => {
    await state.caller.timeEntry.create({
      matterId: state.matterId!,
      date: D.motpartCall.toISOString().slice(0, 10),
      minutes: 60,
      description: "Telefonsamtal med advokat på Skär & Söner — diskuterar förlikning",
      billable: true,
    });
  });

  // ─── 6. Förlikningsmöte + reseutlägg ─────────────────────────────
  it("6. Fysiskt förlikningsmöte (180 min) + reseutlägg", async () => {
    await state.caller.timeEntry.create({
      matterId: state.matterId!,
      date: D.forlikningMote.toISOString().slice(0, 10),
      minutes: 180,
      description: "Förlikningsmöte på BRF:s ombuds kontor (Skär & Söner)",
      billable: true,
    });
    // Tåg + taxi: 562,50 kr inkl moms (6 % moms på tåg, 25 % på taxi)
    await state.caller.expense.create({
      matterId: state.matterId!,
      date: D.forlikningMote.toISOString().slice(0, 10),
      amount: 562_50,
      description: "SJ-biljett + taxi till förlikningsmöte",
      vatRate: 600, // 6 % moms (resor)
      vatIncluded: true,
      billable: true,
    });
  });

  // ─── 7. ACCONTO-faktura skickas ──────────────────────────────────
  it("7. Acconto-faktura — 15 000 kr", async () => {
    const result = await state.caller.billingRun.createAcconto({
      matterId: state.matterId!,
      recipient: "KLIENT",
      clientShareBips: 2000, // påverkar inte beloppet — amountOre är explicit
      amountOre: 1_500_000, // 15 000 kr i öre
      dueDate: new Date(D.accontoDate.getTime() + 30 * 86400000).toISOString().slice(0, 10),
      notes: "Acconto för arbete utfört t.o.m. förlikningsmöte",
    });
    expect(result.invoice.invoiceType).toBe("ACCONTO");
    expect(result.invoice.amount).toBe(1_500_000);
    expect(result.invoice.status).toBe("DRAFT");
    state.accontoInvoiceId = result.invoice.id;
    state.accontoRunId = result.run.id;
  });

  // ─── 8. Acconto betald i sin helhet ──────────────────────────────
  it("8. Klienten betalar accontot — invoice.status = PAID", async () => {
    const pay = await state.caller.invoice.recordPayment({
      invoiceId: state.accontoInvoiceId!,
      amount: 1_500_000,
      paidAt: D.accontoPaid.toISOString(),
      note: "Betalning via bankgiro",
    });
    expect(pay.payment.amount).toBe(1_500_000);
    expect(pay.paidSum).toBe(1_500_000);
    expect(pay.settled).toBe(true);

    const inv = await state.caller.invoice.getById({ id: state.accontoInvoiceId! });
    expect(inv.status).toBe("PAID");
  });

  // ─── 9. Stämningsansökan ─────────────────────────────────────────
  it("9. Stämningsansökan författas — 240 min", async () => {
    await state.caller.timeEntry.create({
      matterId: state.matterId!,
      date: D.stamning.toISOString().slice(0, 10),
      minutes: 240,
      description: "Författande av stämningsansökan till Stockholms tingsrätt",
      billable: true,
    });
  });

  // ─── 10. Förberedande sammanträde ────────────────────────────────
  it("10. Förberedande sammanträde i TR — 75 min", async () => {
    await state.caller.timeEntry.create({
      matterId: state.matterId!,
      date: D.forberedande.toISOString().slice(0, 10),
      minutes: 75,
      description: "Förberedande sammanträde i Stockholms tingsrätt",
      billable: true,
    });
  });

  // ─── 11. Slutförhandling / förlikning vid TR ─────────────────────
  it("11. Förlikning vid TR — 120 min", async () => {
    await state.caller.timeEntry.create({
      matterId: state.matterId!,
      date: D.forlikningTR.toISOString().slice(0, 10),
      minutes: 120,
      description: "Förlikningsförhandling i TR — parterna förlikas",
      billable: true,
    });
  });

  // ─── 12. SLUTFAKTURA — verifiera all beräkning öre för öre ──────
  it("12. Slutfaktura: brutto + acconto-avdrag + netto stämmer öre för öre", async () => {
    const times = await state.caller.timeEntry.list({ matterId: state.matterId! });
    const exps = await state.caller.expense.list({ matterId: state.matterId! });

    // 7 tidsposter: 90 + 120 + 60 + 180 + 240 + 75 + 120 = 885 min
    const totalMinutes = times.entries.reduce((s, t) => s + t.minutes, 0);
    expect(totalMinutes).toBe(885);

    // Brutto från tid: 885 min × 250 000 öre/h ÷ 60 = 3 687 500 öre = 36 875 kr
    const expectedTimeTotal = times.entries.reduce(
      (s, t) => s + Math.round((t.minutes * HOURLY_RATE) / 60), 0,
    );
    expect(expectedTimeTotal).toBe(3_687_500);

    // 1 utlägg: 56 250 öre (= 562,50 kr inkl 6% moms)
    const expectedExpTotal = exps.expenses
      .filter((e) => e.billable)
      .reduce((s, e) => s + e.amount, 0);
    expect(expectedExpTotal).toBe(56_250);

    // Verifiera pure-helpern (samma som routern använder)
    const breakdown = computeFinalInvoiceBreakdown(
      times.entries.map((t) => ({ minutes: t.minutes, hourlyRate: HOURLY_RATE })),
      exps.expenses.map((e) => ({ amount: e.amount, billable: e.billable })),
      [{ id: state.accontoInvoiceId!, amount: 1_500_000 }],
    );
    expect(breakdown.grossAmount).toBe(3_687_500 + 56_250); // 3 743 750 öre
    expect(breakdown.accontoDeductionTotal).toBe(1_500_000);
    expect(breakdown.netAmount).toBe(3_743_750 - 1_500_000); // 2 243 750 öre = 22 437,50 kr

    // Skapa slutfaktura via billing-run (acconto-körningen dras av).
    const result = await state.caller.billingRun.createFinal({
      matterId: state.matterId!,
      recipient: "KLIENT",
      timeEntryIds: times.entries.map((t) => t.id),
      expenseIds: exps.expenses.map((e) => e.id),
      deductedBillingRunIds: [state.accontoRunId!],
      invoiceDate: D.slutfaktura.toISOString().slice(0, 10),
      dueDate: new Date(D.slutfaktura.getTime() + 30 * 86400000).toISOString().slice(0, 10),
      notes: "Slutfaktura — förlikning nådd vid TR. Acconto avräknat.",
    });
    state.finalInvoiceId = result.invoice.id;

    // run bär brutto + nettot; matchar pure-helpern öre för öre.
    expect(result.run.workValueOreAtRun).toBe(breakdown.grossAmount);
    expect(result.run.amountOre).toBe(breakdown.netAmount);
    expect(result.run.workValueOreAtRun - result.run.amountOre).toBe(breakdown.accontoDeductionTotal);

    // billing-run sätter invoice.amount till NETTO (efter acconto-avdrag) — till
    // skillnad mot legacy som satte brutto. Vyns uppdelning räknar ändå om brutto
    // ur de länkade posterna och drar av acconto separat (#728/#729).
    expect(result.invoice.invoiceType).toBe("FINAL");
    expect(result.invoice.amount).toBe(breakdown.netAmount);
  });

  // ─── 13. Full betalning från klienten ────────────────────────────
  it("13. Klienten betalar slutfakturan — invoice.status = PAID", async () => {
    const inv = await state.caller.invoice.getById({ id: state.finalInvoiceId! });
    // billing-run: invoice.amount är redan NETTO (acconto avräknat) → klienten
    // betalar hela beloppet och fakturan blir PAID (inget separat avdrag i ledgern).
    expect(inv.amount).toBe(2_243_750);

    const pay = await state.caller.invoice.recordPayment({
      invoiceId: state.finalInvoiceId!,
      amount: inv.amount,
      paidAt: D.slutPayment.toISOString(),
      note: "Bankgiro — slutbetalning (netto efter acconto-avräkning)",
    });
    expect(pay.payment.amount).toBe(2_243_750);
    expect(pay.paidSum).toBe(2_243_750);
    expect(pay.settled).toBe(true);

    const after = await state.caller.invoice.getById({ id: state.finalInvoiceId! });
    expect(after.status).toBe("PAID");
  });

  // ─── 14. Sluttotaler ─────────────────────────────────────────────
  it("14. Sammanfattning: totaltid, total fakturerat (acconto + final)", async () => {
    const times = await state.caller.timeEntry.list({ matterId: state.matterId! });
    expect(times.totalMinutes).toBe(885); // 14 tim 45 min

    const invoices = await state.caller.invoice.list({ matterId: state.matterId! });
    expect(invoices.length).toBe(2);
    const acconto = invoices.find((i) => i.invoiceType === "ACCONTO");
    const final = invoices.find((i) => i.invoiceType === "FINAL");
    expect(acconto?.amount).toBe(1_500_000);
    // billing-run: FINAL-beloppet är NETTO (brutto 3 743 750 − acconto 1 500 000).
    expect(final?.amount).toBe(2_243_750);

    // Total fakturerat klient = acconto (15 000) + netto-slutfaktura (22 437,50)
    // = 37 437,50 kr = brutto-arbetet. Ingen dubbelräkning.
    const totalBilled = (acconto!.amount) + (final!.amount);
    expect(totalBilled).toBe(3_743_750);
  });
});
