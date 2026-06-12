import { describe, it, expect } from "vitest-compat";
import {
  ledgerAccountMapSchema,
  toSieAccountMap,
  DEFAULT_LEDGER_ACCOUNT_MAP,
  type LedgerAccountMap,
} from "@/lib/shared/accounting/account-map";

const valid: LedgerAccountMap = {
  voucherSeries: "A",
  kundfordran: { number: "1510", name: "Kundfordringar" },
  intaktArvode: { number: "3041", name: "Advokatarvoden" },
  momsUtgaende: { number: "2611", name: "Utgående moms" },
};

describe("ledgerAccountMapSchema", () => {
  it("godtar en giltig mappning (utan utlägg)", () => {
    expect(ledgerAccountMapSchema.safeParse(valid).success).toBe(true);
  });

  it("godtar valfritt utläggskonto", () => {
    const withUtlagg = { ...valid, intaktUtlagg: { number: "3590", name: "Utlägg" } };
    expect(ledgerAccountMapSchema.safeParse(withUtlagg).success).toBe(true);
  });

  it("avvisar kontonummer som inte är 4–6 siffror", () => {
    expect(ledgerAccountMapSchema.safeParse({ ...valid, kundfordran: { number: "15", name: "x" } }).success).toBe(false);
    expect(ledgerAccountMapSchema.safeParse({ ...valid, kundfordran: { number: "ABCD", name: "x" } }).success).toBe(false);
  });

  it("avvisar saknad obligatorisk roll", () => {
    const { momsUtgaende: _omit, ...rest } = valid;
    expect(ledgerAccountMapSchema.safeParse(rest).success).toBe(false);
  });

  it("avvisar tomt kontonamn", () => {
    expect(ledgerAccountMapSchema.safeParse({ ...valid, intaktArvode: { number: "3041", name: "" } }).success).toBe(false);
  });
});

describe("toSieAccountMap", () => {
  it("plockar ut roll→konto utan serie", () => {
    expect(toSieAccountMap(valid)).toEqual({
      kundfordran: { number: "1510", name: "Kundfordringar" },
      intaktArvode: { number: "3041", name: "Advokatarvoden" },
      momsUtgaende: { number: "2611", name: "Utgående moms" },
    });
  });

  it("tar med utläggskontot när det finns", () => {
    const out = toSieAccountMap({ ...valid, intaktUtlagg: { number: "3590", name: "Utlägg" } });
    expect(out.intaktUtlagg).toEqual({ number: "3590", name: "Utlägg" });
  });
});

describe("DEFAULT_LEDGER_ACCOUNT_MAP", () => {
  it("är en giltig mappning med serie A och fyra roller", () => {
    expect(ledgerAccountMapSchema.safeParse(DEFAULT_LEDGER_ACCOUNT_MAP).success).toBe(true);
    expect(DEFAULT_LEDGER_ACCOUNT_MAP.voucherSeries).toBe("A");
    expect(DEFAULT_LEDGER_ACCOUNT_MAP.intaktUtlagg).toBeDefined();
  });
});
