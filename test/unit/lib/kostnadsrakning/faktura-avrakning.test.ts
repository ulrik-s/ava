/**
 * Fakturans avräkningstabell och summeringsruta (#2255; intag #151): raderna
 * summerar exakt till totalen, med en uttrycklig Öresutjämning när det behövs.
 * Bara presentation — beloppen är nedbrytningens egna.
 */
import { describe, it, expect } from "vitest-compat";
import {
  fakturaTotals, formatSettlementRows, hasTableFields, settlementRowText, settlementTable, specSettlementRows,
} from "@/lib/client/kostnadsrakning/faktura-avrakning";
import { buildInvoiceSpecification } from "@/lib/shared/billing/invoice-specification";
import { buildSettlementViews, type SettlementBreakdown, type SettlementRow } from "@/lib/shared/billing/settlement-view";
import { formatKr } from "@/lib/shared/kr-format";

const ore = (n: number): string => `${n} öre`;
const counted = (rows: ReturnType<typeof settlementTable>): number => rows.reduce((s, r) => s + (r.amountOre ?? 0), 0);

/** Självrisk-aconto: underlaget, 20 % av det och momsen — 2 999,60 kr mot fakturans 3 000 kr. */
const ACONTO: SettlementRow[] = [
  { label: "Upparbetat arvode (exkl moms)", amountOre: 1_199_840, kind: "add", role: "basis" },
  { label: "Klientens självrisk (exkl moms)", amountOre: 239_968, kind: "add", basisOre: 1_199_840, shareBips: 2000 },
  { label: "Moms", amountOre: 59_992, kind: "add", basisOre: 239_968, shareBips: 2500 },
  { label: "Självrisk inkl utlägg (inkl moms)", amountOre: 299_960, kind: "add", role: "subtotal" },
];

describe("settlementTable", () => {
  it("underlagsrader i Underlag, mellansummor bort, Öresutjämning så att raderna går jämnt ut", () => {
    const table = settlementTable(ACONTO, 300_000, true);
    expect(table.map((r) => [r.label, r.basisOre, r.shareBips, r.amountOre])).toEqual([
      ["Upparbetat arvode (exkl moms)", 1_199_840, undefined, undefined],
      ["Klientens självrisk (exkl moms)", 1_199_840, 2000, 239_968],
      ["Moms", 239_968, 2500, 59_992],
      ["Öresutjämning", undefined, undefined, 40],
    ]);
    expect(counted(table)).toBe(300_000);
  });

  it("ingen Öresutjämning när raderna redan går jämnt ut", () => {
    const table = settlementTable(ACONTO, 299_960, true);
    expect(table.map((r) => r.label)).not.toContain("Öresutjämning");
    expect(counted(table)).toBe(299_960);
  });

  it("avdrag räknas negativt; info-rader dämpade, beloppet i parentes under Underlag; avdragna underlag med minus", () => {
    const rows: SettlementRow[] = [
      { label: "Upparbetat arvode (exkl moms)", amountOre: 100_000, kind: "add", role: "basis" },
      { label: "Avgår domstolens prutning — byrån bär (exkl moms)", amountOre: 20_000, kind: "deduct", role: "basis" },
      { label: "Beviljat belopp (exkl moms)", amountOre: 80_000, kind: "add" },
      { label: "Avgår klientens rättshjälpsavgift (exkl moms)", amountOre: 20_000, kind: "deduct", basisOre: 80_000, shareBips: 2500 },
      { label: "Rådgivningstimme …", amountOre: 162_600, kind: "info" },
    ];
    const table = settlementTable(rows, 60_000, true);
    expect(counted(table)).toBe(60_000);
    expect(formatSettlementRows(table, ore)).toEqual([
      { label: "Upparbetat arvode (exkl moms)", basis: "100000 öre", share: "", amount: "", muted: false },
      { label: "Avgår domstolens prutning — byrån bär (exkl moms)", basis: "−20000 öre", share: "", amount: "", muted: false },
      { label: "Beviljat belopp (exkl moms)", basis: "", share: "", amount: "80000 öre", muted: false },
      { label: "Avgår klientens rättshjälpsavgift (exkl moms)", basis: "80000 öre", share: "25 %", amount: "-20000 öre", muted: false },
      { label: "Rådgivningstimme …", basis: "(162600 öre)", share: "", amount: "", muted: true },
    ]);
  });

  it("äldre nedbrytningar (utan tabellfält) ritas rad för rad, utan utjämning", () => {
    const legacy: SettlementRow[] = [
      { label: "Upparbetat arvode", amountOre: 100_000, kind: "add" },
      { label: "Klientens självrisk 20 % (exkl moms)", amountOre: 20_000, kind: "add" },
    ];
    expect(hasTableFields(legacy)).toBe(false);
    expect(hasTableFields(ACONTO)).toBe(true);
    expect(settlementTable(legacy, 25_000, false).map((r) => r.label)).toEqual(["Upparbetat arvode", "Klientens självrisk 20 % (exkl moms)"]);
  });
});

/** En slutreglering att bygga riktiga vyer ur (`buildSettlementViews`). */
function breakdown(over: Partial<SettlementBreakdown> = {}): SettlementBreakdown {
  return {
    clientShareBips: 2500, arvodeBaseNetOre: 1_000_033, baseArvodeGrossOre: 1_250_041, expensesGrossOre: 0, clientExpensesGrossOre: 0,
    expensesBaseNetOre: 0, expenseLossNetOre: 0, clientExpensesNetOre: 0, clientExpensesVatOre: 0, payerExpensesNetOre: 0, payerExpensesVatOre: 0,
    sjalvriskNetOre: 250_008, sjalvriskGrossOre: 312_510, firmLossNetOre: 100_000, prutningGrossOre: 125_000,
    payerArvodeNetOre: 650_025, payerArvodeVatOre: 162_506, radgivningGrossOre: 0, radgivningNetOre: 0,
    payerPayableOre: 812_500, clientPayableOre: 312_500, clientArvodeLines: [], deductedAccontos: [], ...over,
  };
}

describe("settlementTable — slutregleringens vyer (#151)", () => {
  for (const method of ["RATTSHJALP", "RATTSSKYDD"] as const) {
    it(`${method}: klientens och betalarens tabell summerar exakt till fakturans belopp`, () => {
      const { clientView, payerView } = buildSettlementViews(breakdown(), method);
      for (const v of [clientView, payerView]) {
        expect(hasTableFields(v.rows)).toBe(true);
        expect(counted(settlementTable(v.rows, v.totalOre, true))).toBe(v.totalOre);
      }
      // Klienten: prutningen och det beviljade beloppet bygger underlaget för andelen.
      const client = settlementTable(clientView.rows, clientView.totalOre, true);
      expect(client.find((r) => r.shareBips === 2500 && r.label.startsWith("Klientens"))?.basisOre).toBe(900_033);
    });
  }

  it("betalaren räknar från det beviljade beloppet", () => {
    const { payerView } = buildSettlementViews(breakdown(), "RATTSHJALP");
    const table = settlementTable(payerView.rows, payerView.totalOre, true);
    expect(table.find((r) => r.label === "Beviljat belopp (exkl moms)")?.amountOre).toBe(900_033);
    expect(table.map((r) => r.label)).not.toContain("Domstolens andel (inkl moms)");
  });
});

describe("specSettlementRows", () => {
  it("summan enligt fakturaraderna, avdragna aconton och justeringen går på fakturans belopp", () => {
    const spec = buildInvoiceSpecification({
      timeLines: [{ date: "2026-05-02", description: "Arbete", minutes: 60, amountOre: 100_000, kind: "ARBETE" }],
      expenseLines: [], rounding: "KRONOR", payableOre: 100_000, deductions: [{ invoiceNumber: "F-1", date: "2026-04-01", amountOre: 20_000 }],
    });
    const rows = specSettlementRows(spec);
    expect(rows.map((r) => [r.label, r.amountOre, r.kind])).toEqual([
      ["Summa enligt fakturaraderna (inkl moms)", 125_000, "add"],
      ["Avgår aconto — faktura F-1 (2026-04-01)", 20_000, "deduct"],
      ["Nedsättning", -5_000, "add"],
    ]);
    expect(counted(settlementTable(rows, 100_000, true))).toBe(100_000);
    const up = buildInvoiceSpecification({ timeLines: [{ date: "2026-05-02", description: "A", minutes: 60, amountOre: 100_000, kind: "ARBETE" }], expenseLines: [], rounding: "KRONOR", payableOre: 130_000, deductions: [] });
    expect(specSettlementRows(up).at(-1)).toMatchObject({ label: "Justering", amountOre: 5_000 });
  });

  it("utan justering och utan datum", () => {
    const spec = buildInvoiceSpecification({ timeLines: [], expenseLines: [], rounding: "KRONOR", payableOre: 80_000, deductions: [{ invoiceNumber: "F-2", date: null, amountOre: 20_000 }] });
    expect(specSettlementRows(spec).map((r) => r.label)).toEqual(["Summa enligt fakturaraderna (inkl moms)", "Avgår aconto — faktura F-2"]);
  });
});

describe("fakturaTotals", () => {
  it("exkl moms, moms (25%) och inkl moms", () => {
    expect(fakturaTotals(125_000, 25_000, formatKr)).toEqual({ exclVat: formatKr(100_000), vatLabel: "Moms (25%)", vat: formatKr(25_000), inclVat: formatKr(125_000) });
  });

  it("blandade satser: bara \"Moms\"; en kredit räknas på beloppen utan tecken", () => {
    expect(fakturaTotals(112_000, 12_000, ore).vatLabel).toBe("Moms");
    expect(fakturaTotals(-125_000, -25_000, ore)).toMatchObject({ vatLabel: "Moms (25%)", exclVat: "-100000 öre" });
  });
});

describe("settlementRowText (fakturasidan)", () => {
  it("andelen och underlaget efter etiketten; utan andel bara etiketten", () => {
    expect(settlementRowText({ label: "Klientens självrisk (exkl moms)", amountOre: 1, kind: "add", basisOre: 1_200_000, shareBips: 2000 }, ore))
      .toBe("Klientens självrisk (exkl moms) — 20 % av 1200000 öre");
    expect(settlementRowText({ label: "Självrisk av täckt arbete (exkl moms)", amountOre: 1, kind: "add", shareBips: 2000 }, ore))
      .toBe("Självrisk av täckt arbete (exkl moms) — 20 %");
    expect(settlementRowText({ label: "Utlägg", amountOre: 1, kind: "add" }, ore)).toBe("Utlägg");
  });
});
