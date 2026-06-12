import { describe, it, expect } from "vitest-compat";
import {
  NO_CAPABILITIES,
  canBookkeep,
  canPullPayments,
  canExportSie,
  assertConnectorMatchesCapabilities,
} from "@/lib/server/integrations/ledger/capabilities";
import {
  ledgerPaymentSchema,
  type LedgerCapabilities,
  type LedgerConnector,
} from "@/lib/server/integrations/ledger/port";

const caps = (over: Partial<LedgerCapabilities> = {}): LedgerCapabilities => ({
  ...NO_CAPABILITIES,
  ...over,
});

describe("ledger capabilities-gating", () => {
  it("NO_CAPABILITIES stänger allt (demo/ingen connector)", () => {
    expect(canBookkeep(NO_CAPABILITIES)).toBe(false);
    expect(canPullPayments(NO_CAPABILITIES)).toBe(false);
    expect(canExportSie(NO_CAPABILITIES)).toBe(false);
  });

  it("canBookkeep sant vid pushVoucher ELLER pushInvoice", () => {
    expect(canBookkeep(caps({ pushVoucher: true }))).toBe(true);
    expect(canBookkeep(caps({ pushInvoice: true }))).toBe(true);
    expect(canBookkeep(caps({ pullPayments: true }))).toBe(false);
  });

  it("canPullPayments / canExportSie speglar sin flagga", () => {
    expect(canPullPayments(caps({ pullPayments: true }))).toBe(true);
    expect(canExportSie(caps({ exportSie: true }))).toBe(true);
    expect(canExportSie(caps({ pullPayments: true }))).toBe(false);
  });
});

describe("assertConnectorMatchesCapabilities", () => {
  it("accepterar en connector där flaggor och metoder matchar", () => {
    const connector: LedgerConnector = {
      name: "test-voucher-only",
      capabilities: () => caps({ pushVoucher: true }),
      pushVoucher: async () => ({ externalId: "A-1" }),
    };
    expect(() => assertConnectorMatchesCapabilities(connector)).not.toThrow();
  });

  it("accepterar en tom connector (allt false, inga metoder)", () => {
    const connector: LedgerConnector = {
      name: "noop",
      capabilities: () => NO_CAPABILITIES,
    };
    expect(() => assertConnectorMatchesCapabilities(connector)).not.toThrow();
  });

  it("kastar när en true-capability saknar sin metod", () => {
    const connector: LedgerConnector = {
      name: "trasig",
      capabilities: () => caps({ pullPayments: true }),
      // pullPayments saknas
    };
    expect(() => assertConnectorMatchesCapabilities(connector)).toThrow(/pullPayments/);
  });

  it("kastar när en metod finns utan motsvarande true-capability", () => {
    const connector: LedgerConnector = {
      name: "odeklarerad",
      capabilities: () => NO_CAPABILITIES,
      exportSie: async () => "#FLAGGA",
    };
    expect(() => assertConnectorMatchesCapabilities(connector)).toThrow(/exportSie/);
  });
});

describe("ledgerPaymentSchema (inbound, strikt)", () => {
  it("godtar en giltig betalning med OCR-referens", () => {
    const p = ledgerPaymentSchema.parse({
      externalId: "camt-054-row-7",
      amount: 12_500,
      date: "2026-06-01",
      ocrReference: "1234567890",
    });
    expect(p.amount).toBe(12_500);
    expect(p.payerName).toBeUndefined();
  });

  it("godtar betalning utan datum (date är valfritt — camt kan sakna ValDt)", () => {
    const p = ledgerPaymentSchema.parse({ externalId: "x", amount: 100 });
    expect(p.date).toBeUndefined();
  });

  it("avvisar negativt/icke-heltals-belopp och fel datumformat (när satt)", () => {
    expect(ledgerPaymentSchema.safeParse({ externalId: "x", amount: -1, date: "2026-06-01" }).success).toBe(false);
    expect(ledgerPaymentSchema.safeParse({ externalId: "x", amount: 100.5, date: "2026-06-01" }).success).toBe(false);
    expect(ledgerPaymentSchema.safeParse({ externalId: "x", amount: 100, date: "1/6 2026" }).success).toBe(false);
  });
});
