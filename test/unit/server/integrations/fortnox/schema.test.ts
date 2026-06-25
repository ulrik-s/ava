import { describe, it, expect } from "vitest-compat";
import { fortnoxMappingFromLedgerMap } from "@/lib/server/integrations/fortnox/schema";
import { DEFAULT_LEDGER_ACCOUNT_MAP, type LedgerAccountMap } from "@/lib/shared/accounting/account-map";

describe("fortnoxMappingFromLedgerMap", () => {
  it("deriverar kontoNUMREN + verifikatserien ur byråns ledger-map", () => {
    expect(fortnoxMappingFromLedgerMap(DEFAULT_LEDGER_ACCOUNT_MAP)).toEqual({
      voucherSeries: "A",
      kundfordran: "1510",
      intaktArvode: "3041",
      momsUtgaende: "2611",
      momsUtgaende12: "2621",
      momsUtgaende06: "2631",
      intaktUtlagg: "3590",
    });
  });

  it("utelämnar intaktUtlagg när byrån inte mappat det (valfritt)", () => {
    const map: LedgerAccountMap = {
      voucherSeries: "B",
      kundfordran: { number: "1510", name: "Kundfordringar" },
      intaktArvode: { number: "3000", name: "Arvode" },
      momsUtgaende: { number: "2611", name: "Utgående moms" },
    };
    const result = fortnoxMappingFromLedgerMap(map);
    expect(result).toEqual({
      voucherSeries: "B",
      kundfordran: "1510",
      intaktArvode: "3000",
      momsUtgaende: "2611",
    });
    expect(result).not.toHaveProperty("intaktUtlagg");
  });

  it("null/undefined ledger-map → null (completeness-gate)", () => {
    expect(fortnoxMappingFromLedgerMap(null)).toBeNull();
    expect(fortnoxMappingFromLedgerMap(undefined)).toBeNull();
  });
});
