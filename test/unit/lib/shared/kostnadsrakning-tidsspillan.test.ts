/**
 * Kostnadsräkningens per-kategori-värdering (#891): arbete på timkostnadsnormen,
 * tidsspillan på tidsspillan-normen — INTE "summa timmar × en taxa". Varje rad får
 * á-pris + belopp; arvodet = summan av raderna.
 */

import { describe, it, expect } from "vitest-compat";
import { coverageEntryRateOre } from "@/lib/shared/brottmalstaxa";
import { buildKostnadsrakningContext } from "@/lib/shared/kostnadsrakning";

describe("kostnadsräkning per kategori (#891)", () => {
  it("värderar arbete och tidsspillan på olika normer och summerar radvis", () => {
    const res = buildKostnadsrakningContext({
      matter: { matterNumber: "2026-0020", title: "Test", radgivningPaid: false },
      defender: { name: "Adv" },
      hufStart: "2026-05-01T09:00:00", hufEnd: "2026-05-01T09:00:00", // ingen HUF
      yrkandeDate: "2026-05-01", // explicit: testet påstår 2026 års normer
      isTaxeArende: false, hasFTax: true,
      expenses: [],
      timeEntries: [
        { id: "t1", date: "2026-03-01", description: "Arbete", minutes: 60, billable: true, kind: "ARBETE" },
        { id: "t2", date: "2026-03-02", description: "Restid", minutes: 60, billable: true, kind: "TIDSSPILLAN" },
      ],
    });
    const lines = res.templateContext.timeLines as Array<{ rateOrePerH: number; amountOre: number; isTidsspillan: boolean }>;
    const arbete = lines.find((l) => !l.isTidsspillan)!;
    const tids = lines.find((l) => l.isTidsspillan)!;
    expect(arbete.rateOrePerH).toBe(162_600); // 1 626 kr/h
    expect(tids.rateOrePerH).toBe(148_700);   // 1 487 kr/h (egen, lägre norm)
    // Arvodet = summan av raderna, INTE 2h × 1626.
    expect(res.arvodeExclVat).toBe(162_600 + 148_700);
    expect(res.arvodeExclVat).not.toBe(2 * 162_600);
  });

  it("2025-daterade poster värderas ändå på KR-datumets (2026) norm — retroaktivt", () => {
    const res = buildKostnadsrakningContext({
      matter: { matterNumber: "x", title: "T", radgivningPaid: false },
      defender: { name: "A" },
      hufStart: "2026-06-01T09:00:00", hufEnd: "2026-06-01T09:00:00",
      yrkandeDate: "2026-06-01",
      isTaxeArende: false, hasFTax: true, expenses: [],
      timeEntries: [{ id: "t1", date: "2025-11-15", description: "Arbete 2025", minutes: 60, billable: true, kind: "ARBETE" }],
    });
    expect(res.arvodeExclVat).toBe(162_600); // 2026 års norm, inte 2025 (158 600)
  });
});

/**
 * Vilket DATUM som styr värderingen (#980).
 *
 * Övergångsbestämmelserna knyter an till när YRKANDET framställs — inte till när
 * arbetet gjordes och inte till när huvudförhandlingen slutade. Räkningen
 * värderades tidigare på `hufEnd`, vilket bara skiljer sig över ett årsskifte:
 * förhandling i december, räkning i januari. Då fick hela räkningen fjolårets
 * normer medan slutregleringen räknade på det nya året.
 */
describe("kostnadsräkningens värderingsdatum (#980)", () => {
  const base = {
    matter: { matterNumber: "2026-0001", title: "T", radgivningPaid: false },
    defender: { name: "A" },
    isTaxeArende: false as const, hasFTax: true, expenses: [],
    timeEntries: [{ id: "t1", date: "2025-11-15", description: "Arbete", minutes: 60, billable: true, kind: "ARBETE" as const }],
  };
  /** Huvudförhandlingen hölls i december 2025 — ett riktigt klockslag. */
  const huf = { hufStart: "2025-12-15T09:00:00", hufEnd: "2025-12-15T11:00:00" };

  it("yrkande i januari 2026 → 2026 års norm, trots förhandling i december", () => {
    const res = buildKostnadsrakningContext({ ...base, ...huf, yrkandeDate: "2026-01-10" });
    const line = (res.templateContext.timeLines as Array<{ rateOrePerH: number }>)[0]!;
    expect(line.rateOrePerH, "timkostnadsnormen för yrkandeåret").toBe(162_600);
  });

  it("yrkande FÖRE årsskiftet → 2025 års norm, samma förhandling", () => {
    // Övergångsbestämmelsen p. 3: äldre föreskrifter gäller yrkanden framställda
    // före den 1 januari 2026. Samma ärende, samma arbete — datumet avgör.
    const res = buildKostnadsrakningContext({ ...base, ...huf, yrkandeDate: "2025-12-20" });
    const line = (res.templateContext.timeLines as Array<{ rateOrePerH: number }>)[0]!;
    expect(line.rateOrePerH).toBe(158_600);
  });

  it("förhandlingens sluttid påverkar INTE beloppet", () => {
    // Regressionsskyddet: det var precis den kopplingen som var felet.
    const dec = buildKostnadsrakningContext({ ...base, ...huf, yrkandeDate: "2026-01-10" });
    const jun = buildKostnadsrakningContext({
      ...base, hufStart: "2026-06-01T09:00:00", hufEnd: "2026-06-01T11:00:00", yrkandeDate: "2026-01-10",
    });
    const rate = (r: typeof dec): number => (r.templateContext.timeLines as Array<{ rateOrePerH: number }>)[0]!.rateOrePerH;
    expect(rate(dec)).toBe(rate(jun));
  });

  it("samma norm som slutregleringen använder för samma datum", () => {
    // Kostnadsräkningen och `billingRun`s slutreglering ska inte kunna ge två
    // olika belopp för samma ärende. Slutregleringen slår upp normen via
    // `coverageEntryRateOre(kind, settleDate)`; här jämförs de rakt av.
    for (const date of ["2025-12-20", "2026-01-10"]) {
      const res = buildKostnadsrakningContext({ ...base, ...huf, yrkandeDate: date });
      const line = (res.templateContext.timeLines as Array<{ rateOrePerH: number }>)[0]!;
      expect(line.rateOrePerH, `norm ${date}`).toBe(coverageEntryRateOre("ARBETE", date));
    }
  });
});
