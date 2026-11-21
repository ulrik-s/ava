import { describe, it, expect } from "vitest-compat";
import {
  FORTNOX_REFRESH_TOKEN_TTL_MS, fortnoxMappingFromLedgerMap, fortnoxStoredTokensSchema,
} from "@/lib/server/integrations/fortnox/schema";
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
      bank: "1930",
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

describe("fortnoxStoredTokensSchema (#1813)", () => {
  const base = { accessToken: "at", refreshToken: "rt", accessTokenExpiresAt: 1 };

  it("läser en äldre post utan förnyelsetid", () => {
    expect(fortnoxStoredTokensSchema.parse(base)).toEqual(base);
  });

  it("läser en post med förnyelsetid och avvisad förnyelse", () => {
    const post = { ...base, renewedAt: 2, reconnectRequiredAt: 3 };
    expect(fortnoxStoredTokensSchema.parse(post)).toEqual(post);
  });

  it("tar bort okända fält", () => {
    expect(fortnoxStoredTokensSchema.parse({ ...base, framtidaFalt: "x" })).toEqual(base);
  });

  it("refresh-token gäller 45 dygn", () => {
    expect(FORTNOX_REFRESH_TOKEN_TTL_MS).toBe(45 * 86_400_000);
  });
});
