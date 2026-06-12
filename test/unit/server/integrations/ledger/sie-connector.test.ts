import { describe, it, expect } from "vitest-compat";
import { SieLedgerConnector, type ExportableVoucher } from "@/lib/server/integrations/ledger/sie-connector";
import { assertConnectorMatchesCapabilities } from "@/lib/server/integrations/ledger/capabilities";
import type { SieAccountMap } from "@/lib/shared/accounting/sie";

const accountMap: SieAccountMap = {
  kundfordran: { number: "1510", name: "Kundfordringar" },
  intaktArvode: { number: "3041", name: "Advokatarvoden" },
  momsUtgaende: { number: "2611", name: "Utgående moms" },
};

const exportable: ExportableVoucher = {
  meta: { series: "A", number: "1" },
  voucher: {
    date: "2026-05-25",
    description: "Faktura F-1",
    rows: [
      { role: "kundfordran", debit: 12_500, credit: 0 },
      { role: "intaktArvode", debit: 0, credit: 10_000 },
      { role: "momsUtgaende", debit: 0, credit: 2_500 },
    ],
  },
};

function makeConnector(vouchers: ExportableVoucher[]) {
  const ranges: { from: string; to: string }[] = [];
  const connector = new SieLedgerConnector({
    company: { name: "Byrå AB" },
    accountMap,
    loadVouchers: async (range) => {
      ranges.push(range);
      return vouchers;
    },
    clock: () => new Date("2026-06-12T08:00:00Z"),
  });
  return { connector, ranges };
}

describe("SieLedgerConnector", () => {
  it("deklarerar bara exportSie-capability (invariant capability⇔metod håller)", () => {
    const { connector } = makeConnector([]);
    expect(connector.name).toBe("sie");
    expect(connector.capabilities()).toEqual({
      pushVoucher: false,
      pushInvoice: false,
      pullPayments: false,
      exportSie: true,
    });
    expect(() => assertConnectorMatchesCapabilities(connector)).not.toThrow();
  });

  it("hämtar verifikat för intervallet och renderar en SIE-fil med injicerat #GEN", async () => {
    const { connector, ranges } = makeConnector([exportable]);
    const sie = await connector.exportSie({ from: "2026-05-01", to: "2026-05-31" });

    expect(ranges).toEqual([{ from: "2026-05-01", to: "2026-05-31" }]);
    expect(sie).toContain("#GEN 20260612"); // från klockan
    expect(sie).toContain('#FNAMN "Byrå AB"');
    expect(sie).toContain('#VER "A" "1" 20260525 "Faktura F-1"');
    expect(sie).toContain("#TRANS 1510 {} 125.00");
  });

  it("tom export ger giltig header utan verifikat", async () => {
    const { connector } = makeConnector([]);
    const sie = await connector.exportSie({ from: "2026-01-01", to: "2026-01-31" });
    expect(sie).toContain("#SIETYP 4");
    expect(sie.includes("#VER")).toBe(false);
  });
});
