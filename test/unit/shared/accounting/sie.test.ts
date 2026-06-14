import { describe, it, expect } from "vitest-compat";
import type { SemanticVoucher } from "@/lib/shared/accounting/semantic-voucher";
import { renderSie, type SieAccountMap, type SieRenderInput } from "@/lib/shared/accounting/sie";

const accountMap: SieAccountMap = {
  kundfordran: { number: "1510", name: "Kundfordringar" },
  intaktArvode: { number: "3041", name: "Advokatarvoden" },
  momsUtgaende: { number: "2611", name: "Utgående moms" },
};

const voucher: SemanticVoucher = {
  date: "2026-05-25",
  description: "Faktura F-2026-0042",
  rows: [
    { role: "kundfordran", debit: 12_500, credit: 0 },
    { role: "intaktArvode", debit: 0, credit: 10_000 },
    { role: "momsUtgaende", debit: 0, credit: 2_500 },
  ],
};

const baseInput: SieRenderInput = {
  company: { name: "Advokatbyrå AB", orgNr: "5566778899" },
  generatedDate: "20260612",
  accountMap,
  vouchers: [{ meta: { series: "A", number: "1" }, voucher }],
};

const lines = (sie: string) => sie.split("\r\n");

describe("renderSie", () => {
  it("skriver obligatorisk header i rätt ordning", () => {
    const out = lines(renderSie(baseInput));
    expect(out.slice(0, 6)).toEqual([
      "#FLAGGA 0",
      '#PROGRAM "AVA" "1.0"',
      "#FORMAT PC8",
      "#GEN 20260612",
      "#SIETYP 4",
      '#FNAMN "Advokatbyrå AB"',
    ]);
    expect(out).toContain("#ORGNR 5566778899");
  });

  it("emittar unika #KONTO-poster, sorterade på kontonummer", () => {
    const out = lines(renderSie(baseInput));
    const konto = out.filter((l) => l.startsWith("#KONTO"));
    expect(konto).toEqual([
      '#KONTO 1510 "Kundfordringar"',
      '#KONTO 2611 "Utgående moms"',
      '#KONTO 3041 "Advokatarvoden"',
    ]);
  });

  it("renderar #VER + #TRANS-block med debet positivt / kredit negativt", () => {
    const out = renderSie(baseInput);
    expect(out).toContain('#VER "A" "1" 20260525 "Faktura F-2026-0042"');
    expect(out).toContain("   #TRANS 1510 {} 125.00"); // debet → positivt
    expect(out).toContain("   #TRANS 3041 {} -100.00"); // kredit → negativt
    expect(out).toContain("   #TRANS 2611 {} -25.00");
  });

  it("verifikatets #TRANS-belopp summerar till 0 (balans-invarianten)", () => {
    const out = lines(renderSie(baseInput));
    const sum = out
      .filter((l) => l.includes("#TRANS"))
      .reduce((s, l) => s + Number(l.trim().split(" ").at(-1)), 0);
    expect(sum).toBeCloseTo(0, 10);
  });

  it("utelämnar #ORGNR när det saknas", () => {
    const out = lines(renderSie({ ...baseInput, company: { name: "Byrå" } }));
    expect(out.some((l) => l.startsWith("#ORGNR"))).toBe(false);
  });

  it("kastar när en roll saknar konto-mappning (completeness-gate)", () => {
    const partial: SieAccountMap = { kundfordran: { number: "1510", name: "Kundfordringar" } };
    expect(() => renderSie({ ...baseInput, accountMap: partial })).toThrow(/saknar konto-mappning/);
  });

  it("hanterar Date-objekt och flera verifikat", () => {
    const out = renderSie({
      ...baseInput,
      vouchers: [
        { meta: { series: "A", number: "1" }, voucher: { ...voucher, date: new Date("2026-05-25T12:00:00Z") } },
        { meta: { series: "A", number: "2" }, voucher },
      ],
    });
    expect(out).toContain('#VER "A" "1" 20260525');
    expect(out).toContain('#VER "A" "2" 20260525');
  });
});
