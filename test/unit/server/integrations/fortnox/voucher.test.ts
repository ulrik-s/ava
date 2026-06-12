import { describe, it, expect } from "vitest-compat";
import { buildVoucherFromInvoice, renderFortnoxVoucher } from "@/lib/server/integrations/fortnox/voucher";
import type { FortnoxKontoMappning } from "@/lib/server/integrations/fortnox/schema";
import type { SemanticVoucher } from "@/lib/shared/accounting/semantic-voucher";

const mapping: FortnoxKontoMappning = {
  voucherSeries: "A",
  kundfordran: "1510",
  intaktArvode: "3041",
  momsUtgaende: "2611",
};

const sum = (rows: { Debit: number; Credit: number }[], k: "Debit" | "Credit") =>
  rows.reduce((s, r) => s + r[k], 0);

describe("buildVoucherFromInvoice", () => {
  it("standardfaktura: 3 balanserade rader (debet kundfordran = kredit intäkt+moms)", () => {
    // 12500 öre brutto inkl 25 % moms → 100 kr netto + 25 kr moms = 125 kr.
    const v = buildVoucherFromInvoice(
      { amount: 12_500, invoiceDate: "2026-05-25", invoiceNumber: "F-2026-0042" },
      mapping,
    );
    expect(v.VoucherSeries).toBe("A");
    expect(v.TransactionDate).toBe("2026-05-25");
    expect(v.Description).toBe("Faktura F-2026-0042");
    expect(v.VoucherRows).toHaveLength(3);

    const byAcct = (n: number) => v.VoucherRows.find((r) => r.Account === n)!;
    expect(byAcct(1510)).toMatchObject({ Debit: 125, Credit: 0 });
    expect(byAcct(3041)).toMatchObject({ Debit: 0, Credit: 100 });
    expect(byAcct(2611)).toMatchObject({ Debit: 0, Credit: 25 });

    // Balans
    expect(sum(v.VoucherRows, "Debit")).toBe(sum(v.VoucherRows, "Credit"));
  });

  it("kreditfaktura (negativt belopp) vänder debet/kredit men håller balans", () => {
    const v = buildVoucherFromInvoice(
      { amount: -12_500, invoiceDate: new Date("2026-05-25T10:00:00Z"), invoiceNumber: "K-2026-0001" },
      mapping,
    );
    const byAcct = (n: number) => v.VoucherRows.find((r) => r.Account === n)!;
    expect(byAcct(1510)).toMatchObject({ Debit: 0, Credit: 125 }); // kundfordran krediteras
    expect(byAcct(3041)).toMatchObject({ Debit: 100, Credit: 0 });
    expect(byAcct(2611)).toMatchObject({ Debit: 25, Credit: 0 });
    expect(sum(v.VoucherRows, "Debit")).toBe(sum(v.VoucherRows, "Credit"));
  });

  it("0 % moms: moms-raden släpps (2 rader kvar, fortf. balanserat)", () => {
    const v = buildVoucherFromInvoice(
      { amount: 10_000, invoiceDate: "2026-01-01" },
      mapping,
      0,
    );
    expect(v.VoucherRows).toHaveLength(2);
    expect(v.VoucherRows.some((r) => r.Account === 2611)).toBe(false);
    expect(sum(v.VoucherRows, "Debit")).toBe(sum(v.VoucherRows, "Credit"));
    expect(v.Description).toBe("Kundfaktura (AVA)"); // saknar invoiceNumber
  });

  it("balans håller även för 'sneda' belopp (öre-rest hamnar i moms)", () => {
    // 10001 öre — momsen blir resten så debet/kredit alltid stämmer.
    const v = buildVoucherFromInvoice({ amount: 10_001, invoiceDate: "2026-03-03" }, mapping);
    expect(sum(v.VoucherRows, "Debit")).toBeCloseTo(sum(v.VoucherRows, "Credit"), 10);
    expect(sum(v.VoucherRows, "Debit")).toBeCloseTo(100.01, 10);
  });
});

describe("renderFortnoxVoucher", () => {
  it("renderar utläggs-rollen mot mappning.intaktUtlagg (öre→SEK)", () => {
    const semantic: SemanticVoucher = {
      date: "2026-04-01",
      description: "Faktura med utlägg",
      rows: [
        { role: "kundfordran", debit: 5_000, credit: 0 },
        { role: "intaktUtlagg", debit: 0, credit: 5_000 },
      ],
    };
    const v = renderFortnoxVoucher(semantic, { ...mapping, intaktUtlagg: "3590" });
    expect(v.Description).toBe("Faktura med utlägg");
    const byAcct = (n: number) => v.VoucherRows.find((r) => r.Account === n)!;
    expect(byAcct(1510)).toMatchObject({ Debit: 50, Credit: 0 });
    expect(byAcct(3590)).toMatchObject({ Debit: 0, Credit: 50 });
  });

  it("kastar om utläggs-rollen används utan kontomappning", () => {
    const semantic: SemanticVoucher = {
      date: "2026-04-01",
      description: "Saknar utläggskonto",
      rows: [{ role: "intaktUtlagg", debit: 0, credit: 5_000 }],
    };
    expect(() => renderFortnoxVoucher(semantic, mapping)).toThrow(/intaktUtlagg/);
  });
});
