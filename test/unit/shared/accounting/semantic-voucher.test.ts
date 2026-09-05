import { describe, it, expect } from "vitest-compat";
import {
  buildSemanticVoucher,
  type SemanticVoucherRow,
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
});
