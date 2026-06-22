/**
 * Scenario-test: brottmål från förordnande till betald faktura
 * ===========================================================
 *
 * Anna Advokat blir förordnad som offentlig försvarare. Vi driver hela
 * målet genom AVA:s tRPC-routrar och verifierar att data + beräkningar
 * stämmer i varje steg. Allt enligt Domstolsverkets brottmålstaxa
 * (DVFS 2025:6) och praxis för försvararuppdrag.
 *
 * Stegen (svensk straffprocess-praxis):
 *
 *   1.  Stockholms tingsrätt RINGER → Anna åtar sig
 *   2.  Förordnande som offentlig försvarare (dokument)
 *   3.  Förundersökningsmaterial granskas (tidsposter)
 *   4.  Möte med klienten + förundersökningsbiträde (tidsposter)
 *   5.  Yttranden till åklagaren (tidsposter + utlägg)
 *   6.  Förundersökningsprotokoll mottages (dokument + tid)
 *   7.  Huvudförhandling i tingsrätten — 2 tim 10 min (HUF-mätning)
 *   8.  Kostnadsräkning till TR — taxa-beräkning verifieras öre för öre
 *   9.  Tingsrättsdom + utlägg (parkering, kopiering)
 *   10. Klienten överklagar → hovrätt
 *   11. Hovrättsförhandling — 1 tim 30 min
 *   12. Hovrättsdom + ny kostnadsräkning
 *   13. Rätten PRUTAR (sätter ned arvodet) — partial-pay-scenario
 *   14. Faktura till Domstolsverket
 *   15. Betalning kommer (delvis) → invoice status → PAID
 *
 * Vi använder ECHTA brottmålstaxa-belopp (DVFS 2025:6) — om något
 * justeras måste testet uppdateras explicit. Det är bra: testet är
 * vår regressionsskydd mot oavsiktliga taxa-tabellsändringar.
 */

import { describe, it, expect, beforeAll } from "vitest-compat";
import { buildGitPorts } from "@/lib/server/adapters/git-ports";
import { DemoDataStore, type DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { appRouter } from "@/lib/server/routers/_app";
import { computeBrottmalstaxa, BROTTMALSTAXA_TABLE } from "@/lib/shared/brottmalstaxa";
import { prebakeJoins } from "@/lib/shared/demo-source";
import { buildKostnadsrakningContext } from "@/lib/shared/kostnadsrakning";

const ORG_ID = "firma-ab";
const ADMIN_USER = { id: "u-anna", email: "anna@firma.local", name: "Anna Advokat", role: "ADMIN" as const, organizationId: ORG_ID };

function makeStore(): { caller: ReturnType<typeof appRouter.createCaller>; source: DemoSource } {
  const source: DemoSource = prebakeJoins({
    organizations: [{ id: ORG_ID, name: "Anna Advokat AB", orgNumber: "556677-8899" }],
    users: [{ ...ADMIN_USER, hourlyRate: 250_000, mileageRate: 250, title: "Senior partner" }],
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

// ─── Faktiska tider — låses upp i ordning ───────────────────────────
const D = {
  call: new Date("2026-02-10T09:30:00Z"),
  forordnande: new Date("2026-02-10T14:00:00Z"),
  granska1: new Date("2026-02-15T10:00:00Z"),
  meeting: new Date("2026-02-20T13:00:00Z"),
  yttrande1: new Date("2026-03-05T16:30:00Z"),
  fup: new Date("2026-03-20T09:00:00Z"),
  hufStart: new Date("2026-04-15T09:00:00Z"),
  hufEnd: new Date("2026-04-15T11:10:00Z"),     // = 2 tim 10 min = 130 min
  tingsrattsdom: new Date("2026-04-29T10:00:00Z"),
  overklagan: new Date("2026-05-05T11:00:00Z"),
  hovrHufStart: new Date("2026-06-10T09:00:00Z"),
  hovrHufEnd: new Date("2026-06-10T10:30:00Z"), // = 1 tim 30 min = 90 min
  hovrDom: new Date("2026-06-24T10:00:00Z"),
};

// State som delas mellan stegen
type State = {
  caller: ReturnType<typeof appRouter.createCaller>;
  source: DemoSource;
  klient?: { id: string };
  domstolTr?: { id: string };
  domstolHovr?: { id: string };
  matterId?: string;
  forordnandeTid?: string;
  granskaTid?: string;
  meetingTid?: string;
  yttrandeTid?: string;
  fupTid?: string;
  hufTid?: string;
  expenseParkeringId?: string;
  expenseKopieringId?: string;
  tingsrattInvoiceId?: string;
  hovrInvoiceId?: string;
};

const state: State = {} as State;

beforeAll(() => {
  const { caller, source } = makeStore();
  state.caller = caller;
  state.source = source;
});

describe("Scenario: brottmål från förordnande till betald faktura", () => {
  // ─── 1. Domstolen ringer — Anna åtar sig ─────────────────────────
  it("1. Anna lägger upp Stockholms tingsrätt som kontakt och tilltalad klient", async () => {
    const tr = await state.caller.contacts.create({
      name: "Stockholms tingsrätt",
      contactType: "COURT",
      orgNumber: "202100-2742",
      email: "stockholms.tingsratt@dom.se",
    });
    expect(tr.id).toBeTruthy();
    state.domstolTr = { id: tr.id };

    const klient = await state.caller.contacts.create({
      name: "Karl Karlsson",
      contactType: "PERSON",
      personalNumber: "19800615-1234",
      notes: "Tilltalad — misstänkt för grovt narkotikabrott.",
    });
    expect(klient.id).toBeTruthy();
    state.klient = { id: klient.id };
  });

  // ─── 2. Skapa ärendet — taxeärende=true, level 1 ─────────────────
  it("2. Anna skapar brottmål markerat som taxeärende, nivå 1, med F-skatt", async () => {
    const matter = await state.caller.matter.create({
      title: "Karl Karlsson — grovt narkotikabrott",
      description: "Mål B 2026-1234. Offentlig försvarare enligt 21 kap. RB.",
      matterType: "Brottmål",
      klientId: state.klient!.id,
      isTaxeArende: true,
    });
    expect(matter.id).toBeTruthy();
    expect(matter.isTaxeArende).toBe(true);
    state.matterId = matter.id;

    // Uppdatera taxa-fälten (level, F-skatt) på matter
    const upd = await state.caller.matter.update({
      id: matter.id,
      taxaLevel: 1,
      taxaHasFTax: true,
    });
    expect(upd.taxaLevel).toBe(1);
    expect(upd.taxaHasFTax).toBe(true);

    // Koppla domstol som DOMSTOL-roll
    await state.caller.matter.addContact({
      matterId: matter.id, contactId: state.domstolTr!.id, role: "DOMSTOL",
    });
    const m = await state.caller.matter.getById({ id: matter.id });
    type MC = { role: string; contact: { id: string } };
    const contacts = m.contacts as MC[];
    expect(contacts.find((c) => c.role === "DOMSTOL")?.contact.id).toBe(state.domstolTr!.id);
    expect(contacts.find((c) => c.role === "KLIENT")?.contact.id).toBe(state.klient!.id);
  });

  // ─── 3. Förundersökning — tidsposter ──────────────────────────────
  it("3. Anna granskar förundersökningsmaterial — 90 min", async () => {
    const te = await state.caller.timeEntry.create({
      matterId: state.matterId!,
      date: D.granska1.toISOString().slice(0, 10),
      minutes: 90,
      description: "Genomgång FUP-handlingar (inledande)",
      billable: true,
    });
    expect(te.minutes).toBe(90);
    state.granskaTid = te.id;
  });

  // ─── 4. Klientmöte + biträdesmöte — 120 min ──────────────────────
  it("4. Möte med klient + biträde — 120 min", async () => {
    const te = await state.caller.timeEntry.create({
      matterId: state.matterId!,
      date: D.meeting.toISOString().slice(0, 10),
      minutes: 120,
      description: "Klientmöte på häktet + möte med försvarssbiträdet",
      billable: true,
    });
    state.meetingTid = te.id;
  });

  // ─── 5. Yttrande till åklagare + utlägg (kopiering) ──────────────
  it("5. Yttrande till åklagaren — 75 min + kopieringsutlägg", async () => {
    const te = await state.caller.timeEntry.create({
      matterId: state.matterId!,
      date: D.yttrande1.toISOString().slice(0, 10),
      minutes: 75,
      description: "Yttrande till åklagaren om bevisuppgifter",
      billable: true,
    });
    state.yttrandeTid = te.id;

    const exp = await state.caller.expense.create({
      matterId: state.matterId!,
      date: D.yttrande1.toISOString().slice(0, 10),
      amount: 38_75, // 38,75 kr i kopieringskostnad (inkl moms)
      description: "Kopiering av handlingar (12 sidor)",
      vatRate: 2500,
      vatIncluded: true,
      billable: true,
    });
    state.expenseKopieringId = exp.id;
  });

  // ─── 6. FUP-protokoll mottages — 105 min granskning ──────────────
  it("6. Granskning av FUP-protokoll efter färdigställande — 105 min", async () => {
    const te = await state.caller.timeEntry.create({
      matterId: state.matterId!,
      date: D.fup.toISOString().slice(0, 10),
      minutes: 105,
      description: "Detaljerad genomgång av slutdelgivet FUP",
      billable: true,
    });
    state.fupTid = te.id;
  });

  // ─── 7. Huvudförhandling — 2 tim 10 min ──────────────────────────
  it("7. Huvudförhandling tingsrätt: 09:00–11:10 = 130 min", async () => {
    // HUF-tid registreras både som timeEntry (för rapporter) och används
    // av kostnadsräkningen för taxa-beräkning.
    const minutes = Math.round((D.hufEnd.getTime() - D.hufStart.getTime()) / 60_000);
    expect(minutes).toBe(130); // 2 tim 10 min

    const te = await state.caller.timeEntry.create({
      matterId: state.matterId!,
      date: D.hufStart.toISOString().slice(0, 10),
      minutes,
      description: "Huvudförhandling i Stockholms tingsrätt",
      billable: true,
    });
    state.hufTid = te.id;

    // Utlägg: parkeringsavgift vid TR
    const parkering = await state.caller.expense.create({
      matterId: state.matterId!,
      date: D.hufStart.toISOString().slice(0, 10),
      amount: 87_50, // 87,50 kr inkl moms
      description: "Parkering vid Stockholms tingsrätt",
      vatRate: 2500,
      vatIncluded: true,
      billable: true,
    });
    state.expenseParkeringId = parkering.id;
  });

  // ─── 8. Kostnadsräkning — VERIFIERA TAXA-BELOPP ÖRE FÖR ÖRE ──────
  it("8. Kostnadsräkning: 130 min HUF, nivå 1 → exakt taxabelopp enligt DVFS 2025:6", async () => {
    // Direkt-anrop till pure helpern (samma som UI:n använder via
    // kostnadsrakning.record). 130 min faller i intervallet 120-134 min
    // ("2 tim - 2 tim 14 min"). Nivå 1 (bara HUF, ingen häktning/RPU).
    // DVFS-tabellen säger: 670 400 öre = 6 704 kr exkl moms.
    const row = BROTTMALSTAXA_TABLE.find((r) => 130 >= r.fromMin && 130 <= r.toMin);
    expect(row).toBeDefined();
    expect(row!.label).toBe("2 tim - 2 tim 14 min");
    expect(row!.ersattning[0]).toBe(670400); // 6 704 kr exkl moms, nivå 1

    const taxa = computeBrottmalstaxa({ huvudforhandlingMinutes: 130, level: 1, hasFTax: true });
    expect(taxa.kind).toBe("taxa-applies");
    expect(taxa.intervalLabel).toBe("2 tim - 2 tim 14 min");
    expect(taxa.ersattningExclVat).toBe(670400);
    // Moms 25 % ovanpå → 1 676 kr → inkl 8 380 kr
    const moms = Math.round(670400 * 0.25);
    expect(moms).toBe(167600);

    // Bygg kostnadsräkning-context (det UI:n visar/genererar)
    const kr = buildKostnadsrakningContext({
      matter: {
        matterNumber: "B 2026-1234",
        title: "Karl Karlsson — grovt narkotikabrott",
        clientName: "Karl Karlsson",
      },
      defender: { name: "Anna Advokat", email: "anna@firma.local" },
      organization: { name: "Anna Advokat AB", orgNumber: "556677-8899" },
      courtName: "Stockholms tingsrätt",
      hufStart: D.hufStart,
      hufEnd: D.hufEnd,
      taxaLevel: 1,
      hasFTax: true,
      expenses: [
        { id: "x1", date: D.yttrande1, description: "Kopiering", amount: 3875, vatIncluded: true },
        { id: "x2", date: D.hufStart, description: "Parkering", amount: 8750, vatIncluded: true },
      ],
    });
    expect(kr.huvudforhandlingMinutes).toBe(130);
    expect(kr.arvodeExclVat).toBe(670400);
    expect(kr.arvodeMoms).toBe(167600);
    expect(kr.arvodeInclVat).toBe(838000); // 8 380 kr inkl moms
    // Utlägg-summa: 3875 + 8750 = 12625 öre inkl moms (= 126,25 kr)
    expect(kr.expenseSummary.inclVat).toBe(12625);
    expect(kr.totalInclVat).toBe(838000 + 12625); // 850 625 öre = 8 506,25 kr
  });

  // ─── 9. Tingsrättsdom + faktura till staten ──────────────────────
  it("9. Skapa slutfaktura (FINAL) för tingsrättsdelen", async () => {
    // Plocka alla unbilled time-entries + expenses → FINAL
    const allTimes = await state.caller.timeEntry.list({ matterId: state.matterId! });
    const allExp = await state.caller.expense.list({ matterId: state.matterId! });
    const timeIds = allTimes.entries.map((t) => t.id);
    const expIds = allExp.expenses.map((e) => e.id);
    expect(timeIds.length).toBe(5); // granska + möte + yttrande + fup + huf
    expect(expIds.length).toBe(2);  // kopiering + parkering

    const result = await state.caller.billingRun.createFinal({
      matterId: state.matterId!,
      recipient: "KLIENT",
      timeEntryIds: timeIds,
      expenseIds: expIds,
      deductedBillingRunIds: [],
      invoiceDate: D.tingsrattsdom.toISOString().slice(0, 10),
      notes: "Tingsrättsdom — Stockholms tingsrätt B 2026-1234",
    });
    expect(result.invoice.invoiceType).toBe("FINAL");
    expect(result.invoice.status).toBe("DRAFT");
    expect(result.invoice.amount).toBeGreaterThan(0);
    state.tingsrattInvoiceId = result.invoice.id;
  });

  // ─── 10. Klienten överklagar — fortsatt arbete ───────────────────
  it("10. Klienten överklagar → nytt arbete: överklagandeskrift 180 min", async () => {
    await state.caller.timeEntry.create({
      matterId: state.matterId!,
      date: D.overklagan.toISOString().slice(0, 10),
      minutes: 180,
      description: "Författande av överklagandeskrift till Svea hovrätt",
      billable: true,
    });
    // Koppla även Svea hovrätt som DOMSTOL (kontakten finns ej, skapa den)
    const hovr = await state.caller.contacts.create({
      name: "Svea hovrätt", contactType: "COURT", orgNumber: "202100-2882",
    });
    state.domstolHovr = { id: hovr.id };
    // Den behöver inte kopplas som matter-DOMSTOL — taxan i hovrätten räknas
    // via separat kostnadsräkning. Vi sparar bara contact:en.
  });

  // ─── 11. Hovrättsförhandling — 90 min ───────────────────────────
  it("11. Hovrättsförhandling: 09:00–10:30 = 90 min", async () => {
    const minutes = Math.round((D.hovrHufEnd.getTime() - D.hovrHufStart.getTime()) / 60_000);
    expect(minutes).toBe(90);
    await state.caller.timeEntry.create({
      matterId: state.matterId!,
      date: D.hovrHufStart.toISOString().slice(0, 10),
      minutes,
      description: "Huvudförhandling i Svea hovrätt",
      billable: true,
    });
  });

  // ─── 12. Hovrättsdom + kostnadsräkning för hovrätten ─────────────
  it("12. Kostnadsräkning hovrätt: 90 min HUF, nivå 1 → 563 500 öre exkl moms", async () => {
    // 90 min faller i intervallet 90-104 min ("1 tim 30 min - 1 tim 44 min")
    // DVFS 2025:6 nivå 1: 563 500 öre = 5 635 kr exkl moms.
    const taxa = computeBrottmalstaxa({ huvudforhandlingMinutes: 90, level: 1, hasFTax: true });
    expect(taxa.intervalLabel).toBe("1 tim 30 min - 1 tim 44 min");
    expect(taxa.ersattningExclVat).toBe(563500);

    const kr = buildKostnadsrakningContext({
      matter: { matterNumber: "B 2026-1234", title: "Karl Karlsson — grovt narkotikabrott" },
      defender: { name: "Anna Advokat" },
      hufStart: D.hovrHufStart,
      hufEnd: D.hovrHufEnd,
      taxaLevel: 1,
      hasFTax: true,
      expenses: [],
    });
    expect(kr.arvodeExclVat).toBe(563500);
    expect(kr.arvodeInclVat).toBe(563500 + Math.round(563500 * 0.25)); // 704 375 öre
  });

  // ─── 13. PRUTNING — rätten sätter ned arvodet ───────────────────
  it("13. Rätten 'prutar' arvodet: yrkat 6 704 kr, dom: 5 000 kr (delvis bifall)", async () => {
    // I praktiken sätts en CREDIT-faktura på mellanskillnaden, ELLER så
    // skapas faktura på det FAKTISKT utdömda beloppet. AVA:s modell: vi
    // kan kreditera och re-fakturera, eller registrera betalning som
    // mindre än fakturerat (delbetalning + nedskrivning).
    //
    // Här testar vi delbetalnings-vägen: faktura står på fullt belopp,
    // betalning kommer på det prutade beloppet, mellanskillnaden får
    // bokas som kreditförlust (annan flöde — utanför detta test).

    const invoice = await state.caller.invoice.getById({ id: state.tingsrattInvoiceId! });
    const yrkat = invoice.amount;
    expect(yrkat).toBeGreaterThan(0);

    // Domen kom på 500 000 öre (5 000 kr) — så DV betalar bara det.
    const utdomtBelopp = 500_000;
    const prutning = yrkat - utdomtBelopp;
    expect(prutning).toBeGreaterThan(0);

    const pay = await state.caller.invoice.recordPayment({
      invoiceId: state.tingsrattInvoiceId!,
      amount: utdomtBelopp,
      paidAt: D.tingsrattsdom.toISOString(),
      note: `Domstolsverket utbetalning enligt dom. Prutning: ${prutning} öre.`,
    });
    expect(pay.payment.amount).toBe(utdomtBelopp);
    expect(pay.paidSum).toBe(utdomtBelopp);
    // Inte fullt betald — settled=false eftersom faktura > betalning
    expect(pay.settled).toBe(false);
  });

  // ─── 14. Verifiera faktura-status efter partial pay ──────────────
  it("14. Faktura är delvis betald — saldo speglar prutningen", async () => {
    const inv = await state.caller.invoice.getById({ id: state.tingsrattInvoiceId! });
    // status PAID sätts bara när hela beloppet är inbetalt — prutning →
    // status stannar i nuvarande (DRAFT/SENT/INSTALLMENT_PLAN), inte PAID.
    expect(inv.status).not.toBe("PAID");

    // Payments-listan har en rad på 500 000 öre
    const payments = (inv as { payments?: Array<{ amount: number }> }).payments ?? [];
    const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
    expect(totalPaid).toBe(500_000);
    // Bokföringsmässigt är prutningen en kundförlust på diff:en (= utanför
    // detta test — det görs typiskt via en CREDIT på ett separat ärende).
  });

  // ─── 15. Slutkontroll — totalt arbete + rapportflödet fungerar ───
  it("15. Rapport: total tid på ärendet matchar alla registrerade poster", async () => {
    const m = await state.caller.timeEntry.list({ matterId: state.matterId! });
    // 5 från TR + 1 (överklagandeskrift) + 1 (hovr-HUF) = 7 poster
    expect(m.entries.length).toBe(7);

    const totalMin = m.entries.reduce((s, e) => s + e.minutes, 0);
    expect(totalMin).toBe(90 + 120 + 75 + 105 + 130 + 180 + 90); // = 790 min
    expect(m.totalMinutes).toBe(790);
  });
});
