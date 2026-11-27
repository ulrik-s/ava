import { describe, it, expect } from "vitest-compat";
import {
  buildPaymentVoucher,
  buildSemanticVoucher,
  type SemanticVoucherRow,
  type VatBreakdownLine,
  type VoucherRole,
} from "@/lib/shared/accounting/semantic-voucher";

const sum = (rows: SemanticVoucherRow[], k: "debit" | "credit") =>
  rows.reduce((s, r) => s + r[k], 0);

const byRole = (rows: SemanticVoucherRow[], role: VoucherRole) =>
  rows.find((r) => r.role === role)!;

describe("buildSemanticVoucher", () => {
  it("standardfaktura: 3 roll-rader, balanserat i öre (debet kundfordran = kredit intäkt+moms)", () => {
    // 12500 öre brutto inkl 25 % moms → 10000 öre netto + 2500 öre moms.
    const v = buildSemanticVoucher({
      amount: 12_500,
      invoiceDate: "2026-05-25",
      invoiceNumber: "F-2026-0042",
    });
    expect(v.date).toBe("2026-05-25");
    expect(v.description).toBe("Faktura F-2026-0042");
    expect(v.rows).toHaveLength(3);

    expect(byRole(v.rows, "kundfordran")).toEqual({ role: "kundfordran", debit: 12_500, credit: 0 });
    expect(byRole(v.rows, "intaktArvode")).toEqual({ role: "intaktArvode", debit: 0, credit: 10_000 });
    expect(byRole(v.rows, "momsUtgaende")).toEqual({ role: "momsUtgaende", debit: 0, credit: 2_500 });

    // Invariant: Σdebet == Σkredit == |belopp|
    expect(sum(v.rows, "debit")).toBe(sum(v.rows, "credit"));
    expect(sum(v.rows, "debit")).toBe(12_500);
  });

  it("använder exakt vatOre när den finns (per-sats, #782) i st.f. 25 %-split", () => {
    // Blandad faktura: brutto 10 600 öre med EXAKT moms 600 (t.ex. 6 %-utlägg)
    // — 25 %-split skulle felaktigt ge 2120 moms.
    const v = buildSemanticVoucher({
      amount: 10_600,
      vatOre: 600,
      invoiceDate: "2026-05-25",
      invoiceNumber: "F-2026-0050",
    });
    expect(byRole(v.rows, "momsUtgaende")).toEqual({ role: "momsUtgaende", debit: 0, credit: 600 });
    expect(byRole(v.rows, "intaktArvode")).toEqual({ role: "intaktArvode", debit: 0, credit: 10_000 });
    expect(sum(v.rows, "debit")).toBe(sum(v.rows, "credit"));
    expect(sum(v.rows, "debit")).toBe(10_600);
  });

  it("titeln innehåller AVA-ärendenumret när det finns (#785)", () => {
    const v = buildSemanticVoucher({ amount: 12_500, invoiceDate: "2026-05-25", invoiceNumber: "F-2026-0042", matterNumber: "AA2026-0001" });
    expect(v.description).toBe("Ärende AA2026-0001 - Faktura F-2026-0042");
  });

  // #1043: Fortnox svarar 400 (code 2000359, "Värdet innehåller ej tillåtna
  // tecken") på `·` U+00B7. Enhetstesterna kör med injicerad fetch och ser
  // aldrig teckenvalideringen, så separatorn måste vaktas här — annars smyger
  // mittpunkten tillbaka och VARJE bokföring fallerar skarpt.
  it("använder ingen exotisk interpunktion Fortnox avvisar (#1043)", () => {
    const v = buildSemanticVoucher({ amount: 12_500, invoiceDate: "2026-05-25", invoiceNumber: "F-2026-0042", matterNumber: "AA2026-0001" });
    expect(v.description).not.toContain("\u00B7");
  });

  it("per-sats breakdown (#790): moms bokförs per sats + intäkt delas arvode/utlägg", () => {
    // Arvode 10 000 + 25 % = 2500 moms; utlägg 1000 @ 6 % = 60 moms.
    const v = buildSemanticVoucher({
      amount: 13_560,
      vatBreakdown: [
        { kind: "arvode", vatRate: 2500, netOre: 10_000, vatOre: 2_500 },
        { kind: "utlagg", vatRate: 600, netOre: 1_000, vatOre: 60 },
      ],
      invoiceDate: "2026-05-25",
      invoiceNumber: "F-2026-0060",
    });
    expect(byRole(v.rows, "kundfordran")).toEqual({ role: "kundfordran", debit: 13_560, credit: 0 });
    expect(byRole(v.rows, "intaktArvode")).toEqual({ role: "intaktArvode", debit: 0, credit: 10_000 });
    expect(byRole(v.rows, "intaktUtlagg")).toEqual({ role: "intaktUtlagg", debit: 0, credit: 1_000 });
    expect(byRole(v.rows, "momsUtgaende")).toEqual({ role: "momsUtgaende", debit: 0, credit: 2_500 });
    expect(byRole(v.rows, "momsUtgaende06")).toEqual({ role: "momsUtgaende06", debit: 0, credit: 60 });
    expect(sum(v.rows, "debit")).toBe(sum(v.rows, "credit"));
    expect(sum(v.rows, "debit")).toBe(13_560);
  });

  it("vatOre = 0 (momsfritt) → ingen moms-rad, balanserat", () => {
    const v = buildSemanticVoucher({ amount: 12_500, vatOre: 0, invoiceDate: "2026-05-25" });
    expect(v.rows.find((r) => r.role === "momsUtgaende")).toBeUndefined();
    expect(byRole(v.rows, "intaktArvode").credit).toBe(12_500);
  });

  it("kreditfaktura (negativt belopp) vänder debet/kredit men håller balans", () => {
    const v = buildSemanticVoucher({
      amount: -12_500,
      invoiceDate: new Date("2026-05-25T10:00:00Z"),
      invoiceNumber: "K-2026-0001",
    });
    expect(byRole(v.rows, "kundfordran")).toEqual({ role: "kundfordran", debit: 0, credit: 12_500 });
    expect(byRole(v.rows, "intaktArvode")).toEqual({ role: "intaktArvode", debit: 10_000, credit: 0 });
    expect(byRole(v.rows, "momsUtgaende")).toEqual({ role: "momsUtgaende", debit: 2_500, credit: 0 });
    expect(sum(v.rows, "debit")).toBe(sum(v.rows, "credit"));
  });

  it("kreditnota med uppdelning: poster kan gå åt OLIKA håll samtidigt (#977)", () => {
    // En slutfaktura krediteras för att acontona (9 000 brutto = 7 200 arvode
    // + 1 800 moms) översteg klientens andel (4 000 arvode + 1 000 moms + 800
    // utlägg + 200 moms). Arvodesintäkten ska MINSKA med 3 200 medan
    // utläggsintäkten ska ÖKA med 800 — utlägget fanns inte i acontot.
    //
    // Förr vändes hela verifikatet med en global flagga, så nettot (−2 400)
    // klumpades på arvodeskontot och `intaktUtlagg` rördes aldrig.
    const v = buildSemanticVoucher({
      amount: -3_000,
      vatOre: -600,
      vatBreakdown: [
        { kind: "arvode", vatRate: 2500, netOre: 4_000, vatOre: 1_000 },
        { kind: "utlagg", vatRate: 2500, netOre: 800, vatOre: 200 },
        { kind: "arvode", vatRate: 2500, netOre: -7_200, vatOre: -1_800 },
      ],
      invoiceDate: "2026-05-25",
    });
    expect(byRole(v.rows, "kundfordran")).toEqual({ role: "kundfordran", debit: 0, credit: 3_000 });
    expect(byRole(v.rows, "intaktArvode")).toEqual({ role: "intaktArvode", debit: 3_200, credit: 0 });
    expect(byRole(v.rows, "intaktUtlagg")).toEqual({ role: "intaktUtlagg", debit: 0, credit: 800 });
    expect(byRole(v.rows, "momsUtgaende")).toEqual({ role: "momsUtgaende", debit: 600, credit: 0 });
    expect(sum(v.rows, "debit")).toBe(sum(v.rows, "credit"));
  });

  it("negativ uppdelning per sats: varje momskonto vänds för sig (#977)", () => {
    // Ren spegling av en faktura med tre satser — kreditnotan ska träffa
    // 2611/2621/2631 var för sig, inte klumpa allt på 25 %-kontot.
    const v = buildSemanticVoucher({
      amount: -11_800,
      vatOre: -1_800,
      vatBreakdown: [
        { kind: "arvode", vatRate: 2500, netOre: -4_000, vatOre: -1_000 },
        { kind: "utlagg", vatRate: 1200, netOre: -5_000, vatOre: -600 },
        { kind: "utlagg", vatRate: 600, netOre: -1_000, vatOre: -200 },
      ],
      invoiceDate: "2026-05-25",
    });
    expect(byRole(v.rows, "momsUtgaende")).toEqual({ role: "momsUtgaende", debit: 1_000, credit: 0 });
    expect(byRole(v.rows, "momsUtgaende12")).toEqual({ role: "momsUtgaende12", debit: 600, credit: 0 });
    expect(byRole(v.rows, "momsUtgaende06")).toEqual({ role: "momsUtgaende06", debit: 200, credit: 0 });
    expect(byRole(v.rows, "intaktUtlagg")).toEqual({ role: "intaktUtlagg", debit: 6_000, credit: 0 });
    expect(sum(v.rows, "debit")).toBe(sum(v.rows, "credit"));
  });

  it("gränsfall: momsvändningen är STÖRRE än kreditbeloppet (#977)", () => {
    // Klientandelen är ett momsfritt äkta utlägg (900) medan acontot bar 25 %
    // (800 + 200). Krediten blir bara 100 kr, men 200 kr moms ska vändas och
    // utläggsintäkten öka med 900. Enkelrads-vägens `Math.min`-klippning gav
    // förr 100 kr moms och ingen intäktsrad alls.
    const v = buildSemanticVoucher({
      amount: -100,
      vatOre: -200,
      vatBreakdown: [
        { kind: "utlagg", vatRate: 0, netOre: 900, vatOre: 0 },
        { kind: "arvode", vatRate: 2500, netOre: -800, vatOre: -200 },
      ],
      invoiceDate: "2026-05-25",
    });
    expect(byRole(v.rows, "momsUtgaende")).toEqual({ role: "momsUtgaende", debit: 200, credit: 0 });
    expect(byRole(v.rows, "intaktUtlagg")).toEqual({ role: "intaktUtlagg", debit: 0, credit: 900 });
    expect(byRole(v.rows, "intaktArvode")).toEqual({ role: "intaktArvode", debit: 800, credit: 0 });
    expect(byRole(v.rows, "kundfordran")).toEqual({ role: "kundfordran", debit: 0, credit: 100 });
    expect(sum(v.rows, "debit")).toBe(sum(v.rows, "credit"));
  });

  it("0 % moms: moms-raden släpps (2 rader kvar, fortf. balanserat)", () => {
    const v = buildSemanticVoucher({ amount: 10_000, invoiceDate: "2026-01-01" }, 0);
    expect(v.rows).toHaveLength(2);
    expect(v.rows.some((r) => r.role === "momsUtgaende")).toBe(false);
    expect(sum(v.rows, "debit")).toBe(sum(v.rows, "credit"));
    expect(v.description).toBe("Kundfaktura (AVA)"); // saknar invoiceNumber
  });

  it("balans håller i öre även för 'sneda' belopp (öre-rest hamnar i moms)", () => {
    const v = buildSemanticVoucher({ amount: 10_001, invoiceDate: "2026-03-03" });
    expect(sum(v.rows, "debit")).toBe(sum(v.rows, "credit"));
    expect(sum(v.rows, "debit")).toBe(10_001);
    // momsen är resten brutto − netto → ingen avrundnings-glipa
    expect(byRole(v.rows, "momsUtgaende").credit).toBe(10_001 - byRole(v.rows, "intaktArvode").credit);
  });

  it("varje rad har exakt en sida > 0 (ren debet ELLER kredit)", () => {
    const v = buildSemanticVoucher({ amount: 12_500, invoiceDate: "2026-05-25" });
    for (const r of v.rows) {
      expect((r.debit > 0 ? 1 : 0) + (r.credit > 0 ? 1 : 0)).toBe(1);
    }
  });

  // #1841: en TOM uppdelning (`vatBreakdown: []`) är ingen uppdelning. Den ska
  // ge enkelradsverifikatet, inte per-sats-vägen (som utan rader blir tom).
  // Facit räknat för hand, oberoende av koden:
  //   12 500 brutto @ 25 % → netto 12 500 / 1,25 = 10 000, moms 2 500.
  //   10 600 brutto med exakt moms 600 → intäkt 10 600 − 600 = 10 000.
  //   Kredit −12 500 → samma belopp, sidorna vända.
  describe("tom momsuppdelning ger enkelradsverifikatet (#1841)", () => {
    const base = { invoiceDate: "2026-05-25", invoiceNumber: "F-2026-0070" };
    const cases = [
      {
        name: "utan vatOre",
        input: { ...base, amount: 12_500 },
        rows: [
          { role: "kundfordran", debit: 12_500, credit: 0 },
          { role: "intaktArvode", debit: 0, credit: 10_000 },
          { role: "momsUtgaende", debit: 0, credit: 2_500 },
        ],
      },
      {
        name: "med vatOre",
        input: { ...base, amount: 10_600, vatOre: 600 },
        rows: [
          { role: "kundfordran", debit: 10_600, credit: 0 },
          { role: "intaktArvode", debit: 0, credit: 10_000 },
          { role: "momsUtgaende", debit: 0, credit: 600 },
        ],
      },
      {
        name: "som kredit",
        input: { ...base, amount: -12_500 },
        rows: [
          { role: "kundfordran", debit: 0, credit: 12_500 },
          { role: "intaktArvode", debit: 10_000, credit: 0 },
          { role: "momsUtgaende", debit: 2_500, credit: 0 },
        ],
      },
    ] as const;

    for (const c of cases) {
      it(`${c.name}: samma rader som utan uppdelning`, () => {
        const empty = buildSemanticVoucher({ ...c.input, vatBreakdown: [] });
        expect(empty.rows).toEqual(c.rows);
        expect(empty.rows).toEqual(buildSemanticVoucher(c.input).rows);
      });
    }
  });
});

// #1902: moms på en sats utan momskonto ger ett fel i stället för ett
// obalanserat verifikat; satsen mappas exakt (förr "närmaste nedåt").
describe("buildSemanticVoucher – moms på en sats utan momskonto (#1902)", () => {
  const base = { invoiceDate: "2026-05-25", invoiceNumber: "F-2026-0090", matterNumber: "AA2026-0007" };
  const PREFIX = "Ärende AA2026-0007 - Faktura F-2026-0090: en rad i momsuppdelningen har ";
  const SUFFIX = ", som saknar momskonto (bara 6, 12 och 25 % har ett). " +
    "Verifikatet skulle inte balansera, så fakturan kan inte bokföras förrän momsuppdelningen är rättad.";
  const build = (lines: VatBreakdownLine[], amount = 0) => () => buildSemanticVoucher({ ...base, amount, vatBreakdown: lines });

  it("intagets motexempel: arvode med 0,01\u00a0kr moms på 0 % kastar", () => {
    expect(build([{ kind: "arvode", vatRate: 0, netOre: 0, vatOre: 1 }])).toThrow(`${PREFIX}0,01\u00a0kr moms på satsen 0 %${SUFFIX}`);
  });

  it("intagets motexempel: utlägg med 1 kr moms på 0 % kastar", () => {
    expect(build([{ kind: "utlagg", vatRate: 0, netOre: 10_000, vatOre: 100 }], 10_100))
      .toThrow(`${PREFIX}1,00\u00a0kr moms på satsen 0 %${SUFFIX}`);
  });

  for (const [vatRate, sats] of [[300, "3"], [1000, "10"], [3000, "30"], [1250, "12,5"]] as const) {
    it(`moms på ${sats} % kastar (förr närmaste konto nedåt)`, () => {
      expect(build([{ kind: "arvode", vatRate, netOre: 10_000, vatOre: 500 }], 10_500))
        .toThrow(`${PREFIX}5,00\u00a0kr moms på satsen ${sats} %${SUFFIX}`);
    });
  }

  it("en kredit med negativ moms på 0 % kastar", () => {
    expect(build([{ kind: "utlagg", vatRate: 0, netOre: -10_000, vatOre: -100 }], -10_100)).toThrow("satsen 0 %");
  });

  it("utan ärende- och fakturanummer börjar felet med den neutrala titeln", () => {
    expect(() => buildSemanticVoucher({ amount: 0, invoiceDate: "2026-05-25", vatBreakdown: [{ kind: "arvode", vatRate: 0, netOre: 0, vatOre: 1 }] }))
      .toThrow("Kundfaktura (AVA): en rad i momsuppdelningen har 0,01\u00a0kr moms");
  });

  it("en udda sats utan moms balanserar, utan momsrad", () => {
    const v = buildSemanticVoucher({ ...base, amount: 10_000, vatBreakdown: [{ kind: "utlagg", vatRate: 1000, netOre: 10_000, vatOre: 0 }] });
    expect(v.rows).toEqual([
      { role: "kundfordran", debit: 10_000, credit: 0 },
      { role: "intaktUtlagg", debit: 0, credit: 10_000 },
    ]);
  });

  it("6, 12 och 25 % bokförs på satsens eget konto", () => {
    const v = buildSemanticVoucher({
      ...base, amount: 14_300, vatBreakdown: [
        { kind: "arvode", vatRate: 2500, netOre: 4_000, vatOre: 1_000 },
        { kind: "utlagg", vatRate: 1200, netOre: 5_000, vatOre: 600 },
        { kind: "utlagg", vatRate: 600, netOre: 3_500, vatOre: 200 },
      ],
    });
    expect(byRole(v.rows, "momsUtgaende").credit).toBe(1_000);
    expect(byRole(v.rows, "momsUtgaende12").credit).toBe(600);
    expect(byRole(v.rows, "momsUtgaende06").credit).toBe(200);
    expect(sum(v.rows, "debit")).toBe(sum(v.rows, "credit"));
  });
});

describe("buildPaymentVoucher (#1173)", () => {
  it("inbetalning: bank debet, kundfordran kredit, balanserat", () => {
    const v = buildPaymentVoucher({ amount: 5000, paidAt: "2026-09-20", invoiceNumber: "F-1", matterNumber: "M-1" });
    expect(v.date).toBe("2026-09-20");
    expect(v.description).toBe("Ärende M-1 - Inbetalning faktura F-1");
    expect(v.rows).toEqual([
      { role: "bank", debit: 5000, credit: 0 },
      { role: "kundfordran", debit: 0, credit: 5000 },
    ]);
  });

  it("återbetalning vänder sidorna; utan nummer en neutral titel", () => {
    const v = buildPaymentVoucher({ amount: -300, paidAt: "2026-09-21" });
    expect(v.description).toBe("Inbetalning (AVA)");
    expect(v.rows).toEqual([
      { role: "bank", debit: 0, credit: 300 },
      { role: "kundfordran", debit: 300, credit: 0 },
    ]);
  });
});
