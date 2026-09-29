/**
 * Kostnadsräkningens dokumentvy (#1218) — ren vy-modell som HTML-mallen och
 * PDF:en ritar ur. Endast syntetisk data.
 */
import { describe, it, expect } from "vitest-compat";
import type { TaxaResult } from "@/lib/shared/brottmalstaxa";
import type { ForordnandeResult, TidsspillanUtover } from "@/lib/shared/forordnandetaxa";
import { toLocalTime, toSwedishLongDate } from "@/lib/shared/iso-date";
import { buildKostnadsrakningContext, withDocumentFields, type BuildInput } from "@/lib/shared/kostnadsrakning";
import { buildKrDocument, cityFromAddress, displayWebsite, vatNumberFromOrgNumber, type KrDocumentInput } from "@/lib/shared/kostnadsrakning-document";
import { expenseSpec, hourlyRowSpecs, timeSpecSections, type KrTimeLineLike } from "@/lib/shared/kostnadsrakning-document-rows";
import { krClaim, roundToKronor, type KrClaim } from "@/lib/shared/kr-claim";
import { formatHours, formatMinutes, formatOreAsKr, formatPlainKr, formatQuantity, formatRateKr } from "@/lib/shared/kr-format";
import { TINY_JPEG, TINY_PNG } from "../../../helpers/tiny-images";

const nb = (s: string): string => s.replace(/ /g, " ");

const DAY = new Date("2026-09-24T12:00:00");

function line(p: Partial<KrTimeLineLike>): KrTimeLineLike {
  return { date: "2026-09-01", description: "Arbete", minutes: 60, kind: "ARBETE", rateOrePerH: 162_600, amountOre: 162_600, ...p };
}

const NO_CLAIM: KrClaim = krClaim({ arvodeRowsOre: [], expenseChargedNetOre: 0, expensePassThroughOre: 0 });

const BASE: KrDocumentInput = {
  matterNumber: "T-1",
  defenderName: "Test Testsson",
  organization: {},
  hasFTax: true,
  yrkandeDate: DAY,
  basis: { kind: "lopande", notes: [] },
  huf: { start: DAY, end: DAY, minutes: 0, rateOrePerH: 162_600, amountOre: 0 },
  timeLines: [],
  expenseLines: [],
  claim: NO_CLAIM,
  radgivningNotice: null,
};

describe("kr-format", () => {
  it("belopp, timmar, á-pris och antal i svensk form", () => {
    expect(nb(formatOreAsKr(5_097_510))).toBe("50 975,10 kr");
    expect(formatHours(1881)).toBe("31,35");
    expect(formatPlainKr(15_200)).toBe("152");
    expect(formatPlainKr(950)).toBe("9,50");
    expect(nb(formatRateKr(162_600))).toBe("1 626 kr");
    expect(formatQuantity(16)).toBe("16");
    expect(formatQuantity(2.5)).toBe("2,5");
  });
  it("minuter i ord", () => {
    expect(formatMinutes(0)).toBe("0 min");
    expect(formatMinutes(50)).toBe("50 min");
    expect(formatMinutes(180)).toBe("3 tim");
    expect(formatMinutes(85)).toBe("1 tim 25 min");
  });
  it("datum i ord och klockslag", () => {
    expect(toSwedishLongDate(DAY)).toBe("24 september 2026");
    expect(toSwedishLongDate("2026-01-05T12:00:00")).toBe("5 januari 2026");
    expect(toLocalTime("2026-01-05T08:05:00")).toBe("08:05");
  });
});

describe("byråns uppgifter", () => {
  it("momsregistreringsnummer ur ett tiosiffrigt organisationsnummer", () => {
    expect(vatNumberFromOrgNumber("556000-0001")).toBe("SE556000000101");
    expect(vatNumberFromOrgNumber("19800101-1234")).toBeUndefined();
    expect(vatNumberFromOrgNumber(undefined)).toBeUndefined();
  });
  it("postorten ur adressen (versaler → gement)", () => {
    expect(cityFromAddress("Testvägen 2, 123 45 TESTSTAD")).toBe("Teststad");
    expect(cityFromAddress("Box 1, 12345 Norra Teststad")).toBe("Norra Teststad");
    expect(cityFromAddress("Testvägen 2")).toBeUndefined();
    expect(cityFromAddress(undefined)).toBeUndefined();
  });
  it("sidfoten utelämnar det som saknas och brevhuvudet är byråns namn", () => {
    const d = buildKrDocument({ ...BASE, organization: { name: "Testbyrån AB", email: "a@b.se", orgNumber: "556000-0001" } });
    expect(d.firmName).toBe("Testbyrån AB");
    expect(d.footerLines).toEqual([["Testbyrån AB"], ["a@b.se"], ["VAT nr: SE556000000101", "Godkänd för F-skatt"]]);
    expect(buildKrDocument({ ...BASE, hasFTax: false }).footerLines).toEqual([]);
  });
  it("webbplatsen visas utan protokoll och avslutande snedstreck", () => {
    expect(displayWebsite("https://www.exempel.se/")).toBe("www.exempel.se");
    expect(displayWebsite("HTTP://exempel.se")).toBe("exempel.se");
    expect(displayWebsite("  ")).toBeUndefined();
    expect(displayWebsite(undefined)).toBeUndefined();
    const d = buildKrDocument({ ...BASE, hasFTax: false, organization: { phone: "010-1", website: "https://www.exempel.se", email: "a@b.se", logo: TINY_PNG, footerSeal: TINY_JPEG } });
    expect(d.footerLines).toEqual([["Tel: 010-1", "www.exempel.se", "a@b.se"]]);
    expect(d.logo).toBe(TINY_PNG);
    expect(d.footerSeal).toBe(TINY_JPEG);
    expect(buildKrDocument(BASE).logo).toBeNull();
  });
  it("ort + datum: uttrycklig ort, postort ur adressen, eller bara datumet", () => {
    expect(buildKrDocument({ ...BASE, organization: { city: " Teststad " } }).placeDate).toBe("Teststad den 24 september 2026");
    expect(buildKrDocument({ ...BASE, organization: { address: "Gatan 1, 111 22 ORTEN" } }).placeDate).toBe("Orten den 24 september 2026");
    expect(buildKrDocument(BASE).placeDate).toBe("24 september 2026");
  });
});

describe("sidhuvudet", () => {
  it("rubrik med målnummer, mottagare, referens = ärendenumret, bankgiro, underskrift", () => {
    const d = buildKrDocument({ ...BASE, courtCaseNumber: " B 1-26 ", courtName: "Teststads tingsrätt", defenderTitle: "Advokat", organization: { bankgiro: "111-2222" } });
    expect(d.title).toBe("KOSTNADSRÄKNING i mål B 1-26");
    expect(d.recipient).toBe("Teststads tingsrätt");
    expect(d.paymentReference).toBe("T-1");
    expect(d.bankgiro).toBe("111-2222");
    expect(d.signatureTitle).toBe("Advokat");
  });
  it("utan målnummer/domstol/bankgiro/titel", () => {
    const d = buildKrDocument({ ...BASE, courtCaseNumber: "  ", courtName: "" });
    expect(d.title).toBe("KOSTNADSRÄKNING");
    expect(d.recipient).toBeNull();
    expect(d.bankgiro).toBeNull();
    expect(d.signatureTitle).toBeNull();
    expect(d.firmName).toBe("");
    expect(d.hasSpecification).toBe(false);
  });
});

describe("sammanställningen — löpande räkning", () => {
  it("en rad per kategori och á-pris, i kategoriordning; beredskap per dygn", () => {
    const rows = hourlyRowSpecs([
      line({ kind: "TIDSSPILLAN", minutes: 846, rateOrePerH: 148_700, amountOre: 2_096_670 }),
      line({ minutes: 1881, amountOre: 5_097_510 }),
      line({ kind: "ADVOKATBEREDSKAP", minutes: 0, rateOrePerH: 0, amountOre: 250_000 }),
      line({ kind: "ADVOKATBEREDSKAP", minutes: 0, rateOrePerH: 0, amountOre: 250_000 }),
      line({ minutes: 60, rateOrePerH: 170_000, amountOre: 170_000 }),
    ]).map((r) => ({ label: r.label, quantity: nb(r.quantity), amountOre: r.amountOre }));
    // Beloppet räknas på gruppens sammanlagda tid (oavrundat — avrundningen sker i krClaim).
    expect(rows).toEqual([
      { label: "ARVODE", quantity: "31,35 á 1 626 kr", amountOre: 5_097_510 },
      { label: "ARVODE", quantity: "1,00 á 1 700 kr", amountOre: 170_000 },
      { label: "TIDSSPILLAN", quantity: "14,10 á 1 487 kr", amountOre: 2_096_670 },
      { label: "ADVOKATBEREDSKAP", quantity: "2 dygn á 2 500 kr", amountOre: 500_000 },
    ]);
  });
  it("dokumentet visar yrkandet: raderna i hela kronor, moms på summan (byråns exempel)", () => {
    const timeLines = [
      line({ minutes: 1881, amountOre: 5_097_510 }),
      line({ kind: "TIDSSPILLAN", minutes: 846, rateOrePerH: 148_700, amountOre: 2_096_670 }),
    ];
    const claim = krClaim({ arvodeRowsOre: [5_097_510, 2_096_670], expenseChargedNetOre: 60_800, expensePassThroughOre: 0 });
    const d = buildKrDocument({ ...BASE, timeLines, claim, expenseLines: [{ date: "2026-09-01", description: "Mil", exclVat: 60_800, vatRate: 2500 }] });
    expect(d.summaryRows.map((r) => nb(r.amount))).toEqual(["50 975,00 kr", "20 967,00 kr", "608,00 kr"]);
    expect(nb(d.totals.exclVat)).toBe("72 550,00 kr");
    expect(nb(d.totals.vat)).toBe("18 138,00 kr");
    expect(nb(d.totals.inclVat)).toBe("90 688,00 kr");
    expect(roundToKronor(-150)).toBe(-100);
  });
  it("utläggsraden (exkl moms) och notiserna; momsetiketten bara (25%) när allt är 25 %", () => {
    const d = buildKrDocument({
      ...BASE, basis: { kind: "lopande", notes: ["En not."] },
      expenseLines: [{ date: "2026-09-01", description: "Tåg", exclVat: 10_000, vatRate: 0 }],
      claim: krClaim({ arvodeRowsOre: [], expenseChargedNetOre: 0, expensePassThroughOre: 10_000 }),
    });
    expect(d.summaryRows.map((r) => [r.label, nb(r.amount)])).toEqual([["UTLÄGG", "100,00 kr"]]);
    expect(d.notes).toEqual(["En not."]);
    expect(d.totals.vatLabel).toBe("Moms");
    expect(buildKrDocument(BASE).totals.vatLabel).toBe("Moms (25%)");
  });
  it("huvudförhandlingen ingår som arvodesrad och i redogörelsen", () => {
    const huf = { start: new Date("2026-09-22T09:00:00"), end: new Date("2026-09-22T11:30:00"), minutes: 150, rateOrePerH: 162_600, amountOre: 406_500 };
    const d = buildKrDocument({ ...BASE, huf, timeLines: [line({})], claim: krClaim({ arvodeRowsOre: [569_100], expenseChargedNetOre: 0, expensePassThroughOre: 0 }) });
    expect(nb(d.summaryRows[0]?.amount ?? "")).toBe("5 691,00 kr");
    expect(nb(d.summaryRows[0]?.quantity ?? "")).toBe("3,50 á 1 626 kr");
    expect(d.specSections[0]?.rows[0]).toEqual({ date: "2026-09-22", description: "Huvudförhandling kl. 09:00–11:30", quantity: "2,50" });
  });
});

describe("arbetsredogörelsen", () => {
  it("avsnitt per kategori med summa; beredskap i dygn", () => {
    const s = timeSpecSections([line({ minutes: 30 }), line({ kind: "ADVOKATBEREDSKAP", minutes: 0 }), line({ minutes: 45 })]);
    expect(s.map((x) => [x.heading, x.sum])).toEqual([["Arvode", "1,25"], ["Advokatberedskap", "1 dygn"]]);
    expect(s[1]?.rows[0]?.quantity).toBe("1 dygn");
  });
  it("utlägg: antal och á-pris bara när båda finns", () => {
    const spec = expenseSpec([
      { date: "2026-09-01", description: "Milersättning", exclVat: 15_200, vatRate: 0, quantity: 16, unitPriceOre: 950 },
      { date: "2026-09-02", description: "Parkering", exclVat: 5_050, vatRate: 2500, quantity: 1 },
    ], 20_250);
    expect(spec?.rows).toEqual([
      { date: "2026-09-01", description: "Milersättning", quantity: "16", unitPrice: "9,50", amount: "152" },
      { date: "2026-09-02", description: "Parkering", quantity: "", unitPrice: "", amount: "50,50" },
    ]);
    expect(spec?.sum).toBe("202,50");
    expect(expenseSpec([], 0)).toBeNull();
  });
});

describe("taxeärenden", () => {
  const taxa = (kind: TaxaResult["kind"]): TaxaResult => ({ kind, level: 1, intervalLabel: "2 tim - 2 tim 14 min", ersattningExclVat: 563_500, gransvardeExclVat: 0, notes: [] });
  const huf = { start: new Date("2026-09-22T09:00:00"), end: new Date("2026-09-22T11:10:00"), minutes: 130, rateOrePerH: 0, amountOre: 0 };
  /** Ingen tidsspillan utöver taxan. */
  const noExtra: TidsspillanUtover = { ingarOvrigMinutes: 0, ingarVardagMinutes: 0, extraVardagMinutes: 0, extraOvrigMinutes: 0, vardagRateOre: 0, ovrigRateOre: 0, amountOre: 0 };

  it("brottmålstaxa: taxeraden + noter, redogörelsen 'ingår i taxan'", () => {
    const d = buildKrDocument({ ...BASE, huf, basis: { kind: "brottmalstaxa", level: 1, taxa: taxa("taxa-applies"), tidsspillan: noExtra } });
    expect(d.summaryRows.map((r) => [r.label, r.quantity, nb(r.amount)])).toEqual([["ARVODE ENLIGT BROTTMÅLSTAXAN", "2,17 tim", "5 635,00 kr"]]);
    expect(d.notes).toEqual(["Huvudförhandling 2026-09-22 kl. 09:00–11:10.", "Brottmålstaxa (DVFS 2025:6), nivå 1, intervall 2 tim - 2 tim 14 min."]);
    expect(d.specSections[0]?.heading).toBe("Arvode (ingår i taxan)");
  });
  it("brottmålstaxa över maxgränsen: ingen taxerad, varningsnot", () => {
    const d = buildKrDocument({ ...BASE, huf, basis: { kind: "brottmalstaxa", level: 1, taxa: taxa("exceeds-max"), tidsspillan: noExtra } });
    expect(d.summaryRows).toEqual([]);
    expect(d.notes[1]).toMatch(/överstiger taxans maxgräns/);
  });
  it("förordnandetaxa: taxerad + tidsspillan utöver taxan (båda kategorierna), gränsvärdesvarning, förhören", () => {
    const ford: Extract<ForordnandeResult, { kind: "taxa" }> = {
      kind: "taxa", forhorMinutes: 85, taxa: taxa("taxa-applies"), arvodeExclVat: 0, gransvardeOverskrids: true,
      tidsspillan: { ingarOvrigMinutes: 30, ingarVardagMinutes: 30, extraVardagMinutes: 120, extraOvrigMinutes: 30, vardagRateOre: 148_700, ovrigRateOre: 97_500, amountOre: 0 },
    };
    const d = buildKrDocument({ ...BASE, basis: { kind: "forordnande", ford }, forhor: [{ start: "2026-03-02T08:00:00", end: "2026-03-02T08:50:00" }] });
    expect(d.summaryRows.map((r) => [r.label, nb(r.quantity), nb(r.amount)])).toEqual([
      ["ARVODE ENLIGT TAXA I FÖRORDNANDEMÅL", "1,42 tim", "5 635,00 kr"],
      ["TIDSSPILLAN UTÖVER TAXAN", "2,00 á 1 487 kr", "2 974,00 kr"],
      ["TIDSSPILLAN ANNAN TID UTÖVER TAXAN", "0,50 á 975 kr", "487,50 kr"],
    ]);
    expect(d.notes[1]).toBe("Tidsspillan totalt 3 tim 30 min, varav 1 tim ingår i taxan.");
    expect(d.notes[2]).toMatch(/taxan får frångås/);
    expect(d.specSections[0]).toEqual({ heading: "Förhör under förundersökningen", rows: [{ date: "2026-03-02", description: "Förhör kl. 08:00–08:50", quantity: "0,83" }], sum: "0,83" });
    expect(d.hasSpecification).toBe(true);
  });
});

describe("dokumentfälten via buildKostnadsrakningContext", () => {
  const input: BuildInput = {
    matter: { matterNumber: "T-9", title: "x" }, defender: { name: "Test" }, expenses: [],
    hufStart: DAY, hufEnd: DAY, yrkandeDate: DAY, isTaxeArende: false,
  };
  it("withDocumentFields lägger fälten rätt och rör inget som utelämnas", () => {
    const merged = withDocumentFields(input, { courtCaseNumber: "B 9-26", defenderTitle: "Advokat", organizationBankgiro: "1-1", organizationPhone: undefined, organizationWebsite: "www.x.se", organizationLogo: TINY_PNG });
    expect(merged.matter.courtCaseNumber).toBe("B 9-26");
    expect(merged.defender.title).toBe("Advokat");
    expect(merged.organization).toEqual({ bankgiro: "1-1", website: "www.x.se", logo: TINY_PNG });
    const r = buildKostnadsrakningContext(merged);
    expect(r.document.title).toBe("KOSTNADSRÄKNING i mål B 9-26");
    expect(r.templateContext.document).toBe(r.document);
    expect(r.templateContext.courtCaseNumber).toBe("B 9-26");
    expect(r.templateContext.organizationBankgiro).toBe("1-1");
  });
  it("utläggens antal/á-pris följer med till dokumentet", () => {
    const r = buildKostnadsrakningContext({ ...input, expenses: [{ id: "e", date: DAY, description: "Mil", amount: 15_200, vatRate: 0, vatIncluded: false, quantity: 16, unitPriceOre: 950 }] });
    expect(r.expenseLines[0]).toMatchObject({ quantity: 16, unitPriceOre: 950 });
    expect(r.document.expenseSpec?.rows[0]).toMatchObject({ quantity: "16", unitPrice: "9,50", amount: "152" });
  });
});
