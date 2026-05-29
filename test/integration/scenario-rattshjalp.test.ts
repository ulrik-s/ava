/**
 * Scenario-test: statligt betalt non-taxemål
 * ==========================================
 *
 * Inte alla mål är taxemål. Bara vissa: enkla brottmål med offentlig
 * försvarare där HUF ≤ 3 tim 45 min, konkursförvaltning, vissa
 * förordnandeuppdrag. Övriga statligt betalda uppdrag — komplexa
 * brottmål, rättshjälp i tvistemål, offentligt biträde i förvaltnings-
 * och migrationsmål, vårdnadsmål LVU/LPT — ersätts enligt
 * Domstolsverkets timkostnadsnorm × faktisk arbetstid, tidsspillan
 * och utlägg (DVFS 2025:6 § 8).
 *
 * Detta scenario: ett KOMPLEXT brottmål där huvudförhandlingen sträcker
 * sig över 8 timmar (förhandlingstid > 225 min) → taxan tillämpas INTE,
 * trots offentlig försvarare. Anna debiterar staten:
 *   • Arbete (förundersökning, möten, författande) — timkostnadsnorm
 *   • HUF-tid — timkostnadsnorm (eftersom > taxa-max)
 *   • Tidsspillan (restid + väntan utan arbete) — timkostnadsnorm
 *   • Utlägg
 *
 * Timkostnadsnorm 2026 (DVFS 2025:6 § 8): 1 626 kr/h exkl moms med F-skatt.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { DemoDataStore, type DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { prebakeJoins } from "@/lib/client/demo/prebake-joins";
import { appRouter } from "@/lib/server/routers/_app";
import { buildGitPorts } from "@/lib/server/adapters/git-ports";
import {
  computeBrottmalstaxa,
  computeTimkostnadsnorm,
  TIMKOSTNADSNORM_FTAX_ORE_PER_H,
  TIMKOSTNADSNORM_NO_FTAX_ORE_PER_H,
  TAXA_MAX_MINUTES,
} from "@/lib/shared/brottmalstaxa";

const ORG_ID = "firma-ab";
const ADMIN_USER = {
  id: "u-anna", email: "anna@firma.local", name: "Anna Advokat",
  role: "ADMIN" as const, organizationId: ORG_ID,
};

function makeStore(): { caller: ReturnType<typeof appRouter.createCaller>; source: DemoSource } {
  const source: DemoSource = prebakeJoins({
    organizations: [{ id: ORG_ID, name: "Anna Advokat AB", orgNumber: "556677-8899" }],
    // OBS: vi sätter timtaxa = timkostnadsnormen så time-entries beräknas
    // korrekt mot DV-normen i routerns invoice-flöde.
    users: [{ ...ADMIN_USER, hourlyRate: TIMKOSTNADSNORM_FTAX_ORE_PER_H, mileageRate: 250, title: "Senior partner" }],
    contacts: [], matters: [], matterContacts: [],
    documents: [], timeEntries: [], expenses: [],
    invoices: [], calendarEvents: [], tasks: [],
    documentTemplates: [], conflictChecks: [], offices: [],
    paymentPlans: [], paymentPlanReminders: [], payments: [],
  } as DemoSource);
  const dataStore = new DemoDataStore(source, async () => { /* no-op */ });
  const ports = buildGitPorts(dataStore);
  const caller = appRouter.createCaller({
    user: ADMIN_USER, dataStore, ports,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  return { caller, source };
}

interface State {
  caller: ReturnType<typeof appRouter.createCaller>;
  klientId?: string;
  domstolId?: string;
  matterId?: string;
  invoiceId?: string;
}
const state: State = {} as State;

beforeAll(() => {
  const s = makeStore();
  state.caller = s.caller;
});

describe("Scenario: komplext brottmål — offentlig försvarare men EJ taxemål (HUF > 225 min)", () => {
  // ─── 0. Locka taxa-tröskeln: tabellen kontra DV-normen ─────────────
  it("0. Konstanter: TAXA_MAX_MINUTES=225 + timkostnadsnorm 2026", () => {
    expect(TAXA_MAX_MINUTES).toBe(225);
    expect(TIMKOSTNADSNORM_FTAX_ORE_PER_H).toBe(162_600); // 1 626 kr/h
    expect(TIMKOSTNADSNORM_NO_FTAX_ORE_PER_H).toBe(123_700); // 1 237 kr/h
  });

  // ─── 1. Skapa ärendet ─────────────────────────────────────────────
  it("1. Anna lägger upp domstolen, klienten, ärendet", async () => {
    const tr = await state.caller.contacts.create({
      name: "Solna tingsrätt", contactType: "COURT", orgNumber: "202100-2742",
    });
    state.domstolId = tr.id;
    const klient = await state.caller.contacts.create({
      name: "Tomas Talesman", contactType: "PERSON",
      personalNumber: "19790203-9876",
      notes: "Tilltalad — flerårig misstänkt ekonomisk brottslighet.",
    });
    state.klientId = klient.id;

    const matter = await state.caller.matter.create({
      title: "Tomas Talesman — grov ekobrottslighet (omfattande)",
      description: "Mål B 2026-9999. Solna TR. 17 åtalspunkter, 8 vittnen.",
      matterType: "Brottmål",
      klientId: state.klientId!,
      // Initialt markerat som taxeärende — typiskt för brottmål med
      // offentlig försvarare. Men HUF visar sig bli > 225 min →
      // taxan TILLÄMPAS INTE, trots flaggan.
      isTaxeArende: true,
    });
    state.matterId = matter.id;
    await state.caller.matter.addContact({
      matterId: matter.id, contactId: state.domstolId!, role: "DOMSTOL",
    });
  });

  // ─── 2. Registrera arbetstid: 60 timmar förarbete ──────────────────
  it("2. Förarbete: FUP-granskning (20 h), klientmöten (8 h), yttranden (12 h) = 40 h", async () => {
    const tasks = [
      { d: "2026-01-15", min: 480, desc: "Granskning av FUP del 1 (8h)" },
      { d: "2026-01-22", min: 480, desc: "Granskning av FUP del 2 (8h)" },
      { d: "2026-01-29", min: 240, desc: "Granskning av FUP del 3 (4h)" },
      { d: "2026-02-05", min: 120, desc: "Klientmöte på häkte (2h)" },
      { d: "2026-02-12", min: 120, desc: "Klientmöte på häkte (2h)" },
      { d: "2026-02-19", min: 120, desc: "Klientmöte på häkte (2h)" },
      { d: "2026-02-26", min: 120, desc: "Klientmöte på häkte (2h)" },
      { d: "2026-03-05", min: 360, desc: "Yttrande till åklagaren del 1 (6h)" },
      { d: "2026-03-12", min: 360, desc: "Yttrande till åklagaren del 2 (6h)" },
    ];
    for (const t of tasks) {
      await state.caller.timeEntry.create({
        matterId: state.matterId!,
        date: t.d, minutes: t.min, description: t.desc, billable: true,
      });
    }
    const sum = tasks.reduce((s, t) => s + t.min, 0);
    expect(sum).toBe(40 * 60); // 2 400 min = 40 timmar
  });

  // ─── 3. Huvudförhandling i tre dagar — 8h totalt ─────────────────
  it("3. Huvudförhandling 3 dagar, 8 tim TOTAL = 480 min — överskrider taxa-max", async () => {
    // Huvudförhandling är typiskt utspridd över flera dagar; det är den
    // SAMMANLAGDA tiden som räknas mot taxa-max (225 min). Med 480 min
    // (8 h) tillämpas inte taxan.
    const days = [
      { d: "2026-04-10", min: 180 }, // dag 1: 3 h
      { d: "2026-04-11", min: 180 }, // dag 2: 3 h
      { d: "2026-04-12", min: 120 }, // dag 3: 2 h
    ];
    for (const d of days) {
      await state.caller.timeEntry.create({
        matterId: state.matterId!,
        date: d.d, minutes: d.min, description: "Huvudförhandling Solna TR", billable: true,
      });
    }
    const sumHuf = days.reduce((s, d) => s + d.min, 0);
    expect(sumHuf).toBe(480);
    expect(sumHuf).toBeGreaterThan(TAXA_MAX_MINUTES);

    // Taxan tillämpas INTE för HUF > 225 min
    const taxa = computeBrottmalstaxa({ huvudforhandlingMinutes: sumHuf, level: 1, hasFTax: true });
    expect(taxa.kind).toBe("exceeds-max");
    expect(taxa.ersattningExclVat).toBe(0);
    expect(taxa.notes.join(" ")).toMatch(/timkostnadsnorm/);
  });

  // ─── 4. Tidsspillan — restid + väntan ──────────────────────────────
  it("4. Tidsspillan: restid Stockholm–Solna ×3 dagar + väntan i häktet", async () => {
    // Restid räknas normalt som faktisk arbetstid. Väntan i häktet,
    // dvs när klienten hämtas men möte inte ännu påbörjat, räknas som
    // tidsspillan (DV-praxis: samma timkostnadsnorm).
    //
    // Vi registrerar väntan som "tidsspillan"-poster (egen kategori).
    // I AVA finns ingen specifik tidsspillan-typ — vi modellerar den
    // som vanliga time-entries med "[tidsspillan]"-prefix.
    const tidsspillanPosts = [
      { d: "2026-02-05", min: 30, desc: "[tidsspillan] Väntan på klient i häktet" },
      { d: "2026-02-12", min: 25, desc: "[tidsspillan] Väntan på klient i häktet" },
      { d: "2026-04-10", min: 45, desc: "[tidsspillan] Restid TR HUF dag 1" },
      { d: "2026-04-11", min: 45, desc: "[tidsspillan] Restid TR HUF dag 2" },
      { d: "2026-04-12", min: 30, desc: "[tidsspillan] Restid TR HUF dag 3" },
    ];
    for (const p of tidsspillanPosts) {
      await state.caller.timeEntry.create({
        matterId: state.matterId!,
        date: p.d, minutes: p.min, description: p.desc, billable: true,
      });
    }
    const sum = tidsspillanPosts.reduce((s, p) => s + p.min, 0);
    expect(sum).toBe(175); // 2h 55min totalt
  });

  // ─── 5. Verifiera timkostnadsnorm-beräkningen ──────────────────────
  it("5. Beräkna ersättning: 40h förarbete + 8h HUF + 175 min tidsspillan", async () => {
    // Totalt arbete (faktisk arbetstid):  40h × 60 + 480 min = 2880 min
    // Tidsspillan:                        175 min
    const arbete = 40 * 60 + 480;
    const tidsspillan = 175;
    expect(arbete).toBe(2880);

    const result = computeTimkostnadsnorm({
      arbetsMinutes: arbete,
      tidsspillanMinutes: tidsspillan,
      hasFTax: true,
    });

    // Arbete: 2 880 min × 162 600 öre/h ÷ 60 = 7 804 800 öre = 78 048 kr exkl moms
    expect(result.rateOrePerH).toBe(162_600);
    expect(result.arbete).toBe(7_804_800);
    // Tidsspillan: 175 min × 162 600 öre/h ÷ 60 = 474 250 öre = 4 742,50 kr exkl moms
    expect(result.tidsspillan).toBe(474_250);
    // Totalt: 8 279 050 öre exkl moms = 82 790,50 kr
    expect(result.total).toBe(8_279_050);

    // Moms 25 %: 2 069 763 öre → inkl 10 348 813 öre
    const moms = Math.round(result.total * 0.25);
    expect(moms).toBe(2_069_763);
    const inklMoms = result.total + moms;
    expect(inklMoms).toBe(10_348_813); // 103 488,13 kr
  });

  // ─── 6. Utan F-skatt: 1237/1626-justering ──────────────────────────
  it("6. Advokat utan F-skatt: ersättning × 1237/1626 (DVFS 11 §)", () => {
    const noFTax = computeTimkostnadsnorm({
      arbetsMinutes: 60, // 1 h
      hasFTax: false,
    });
    // 1 h × 1 237 kr/h = 1 237 kr = 123 700 öre
    expect(noFTax.rateOrePerH).toBe(123_700);
    expect(noFTax.arbete).toBe(123_700);

    // Och ratio mot F-skatt-värdet (med rundningstolerans 1 öre)
    const withFTax = computeTimkostnadsnorm({ arbetsMinutes: 60, hasFTax: true });
    expect(withFTax.arbete).toBe(162_600);
    const ratio = noFTax.arbete / withFTax.arbete;
    expect(ratio).toBeCloseTo(1237 / 1626, 4);
  });

  // ─── 7. Lägg till utlägg ───────────────────────────────────────────
  it("7. Utlägg: parkering ×3 + lunchkupong ×3 + portokostnader", async () => {
    const exp = [
      { amount: 87_50, desc: "Parkering Solna TR dag 1", rate: 2500 },
      { amount: 87_50, desc: "Parkering Solna TR dag 2", rate: 2500 },
      { amount: 87_50, desc: "Parkering Solna TR dag 3", rate: 2500 },
      { amount: 24_00, desc: "Porto rekommenderat brev till klient", rate: 2500 },
    ];
    for (const e of exp) {
      await state.caller.expense.create({
        matterId: state.matterId!,
        date: "2026-04-10",
        amount: e.amount, description: e.desc,
        vatRate: e.rate, vatIncluded: true, billable: true,
      });
    }
    const total = exp.reduce((s, e) => s + e.amount, 0);
    expect(total).toBe(28_650); // 286,50 kr inkl moms
  });

  // ─── 8. Slutfaktura ────────────────────────────────────────────────
  it("8. Slutfaktura: 9 + 3 + 5 timeposter = 17 + 4 utlägg, status DRAFT", async () => {
    const times = await state.caller.timeEntry.list({ matterId: state.matterId! });
    const exps = await state.caller.expense.list({ matterId: state.matterId! });
    expect(times.entries.length).toBe(9 + 3 + 5); // förarbete + HUF + tidsspillan
    expect(exps.expenses.length).toBe(4);

    // Total minutes 40*60 + 480 + 175 = 3055
    expect(times.totalMinutes).toBe(3055);

    const r = await state.caller.invoice.createFinal({
      matterId: state.matterId!,
      timeEntryIds: times.entries.map((t) => t.id),
      expenseIds: exps.expenses.map((e) => e.id),
      accontoInvoiceIds: [],
      invoiceDate: "2026-04-25",
      notes: "Domstolsverket — komplext brottmål, HUF > 225 min → timkostnadsnorm.",
    });
    expect(r.invoice.invoiceType).toBe("FINAL");

    // Routerns gross-beräkning: 3055 min × 162 600 öre/h ÷ 60 = 8 279 050 öre
    // (× minuter ÷ 60, INT-aritmetik, kan ge ±1 öre rundningsskillnad)
    const expectedTime = times.entries.reduce(
      (s, t) => s + Math.round((t.minutes * TIMKOSTNADSNORM_FTAX_ORE_PER_H) / 60), 0,
    );
    expect(expectedTime).toBe(8_279_050);
    expect(r.breakdown.grossAmount).toBe(expectedTime + 28_650);
    state.invoiceId = r.invoice.id;
  });

  // ─── 9. Påminnelse: distinktionen taxa-mål vs non-taxa ────────────
  it("9. Distinktion: 100 min HUF → taxa-mål; 300 min HUF → non-taxa", () => {
    // Samma ärende-typ (brottmål med offentlig försvarare) men olika
    // ersättningsregim beroende på HUF-tiden.
    const taxa100 = computeBrottmalstaxa({ huvudforhandlingMinutes: 100, level: 1, hasFTax: true });
    expect(taxa100.kind).toBe("taxa-applies");
    expect(taxa100.ersattningExclVat).toBeGreaterThan(0);

    const taxa300 = computeBrottmalstaxa({ huvudforhandlingMinutes: 300, level: 1, hasFTax: true });
    expect(taxa300.kind).toBe("exceeds-max");
    expect(taxa300.ersattningExclVat).toBe(0); // → använd timkostnadsnorm

    // Och då räknar vi 300 min × 1 626 kr/h = 813 000 öre = 8 130 kr exkl moms
    const norm300 = computeTimkostnadsnorm({ arbetsMinutes: 300, hasFTax: true });
    expect(norm300.arbete).toBe(813_000);
  });
});
