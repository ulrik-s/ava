import { describe, it, expect } from "vitest-compat";
import { FortnoxLedgerConnector } from "@/lib/server/integrations/fortnox/connector";
import { assertConnectorMatchesCapabilities } from "@/lib/server/integrations/ledger/capabilities";
import type { FortnoxClient } from "@/lib/server/integrations/fortnox/client";
import type { FortnoxKontoMappning, FortnoxVoucher, FortnoxVoucherResponse } from "@/lib/server/integrations/fortnox/schema";
import type { SemanticVoucher } from "@/lib/shared/accounting/semantic-voucher";

const MAPPING: FortnoxKontoMappning = {
  voucherSeries: "A",
  kundfordran: "1510",
  intaktArvode: "3041",
  momsUtgaende: "2611",
};

function makeClient() {
  const calls: FortnoxVoucher[] = [];
  const client: Pick<FortnoxClient, "createVoucher"> = {
    createVoucher: async (v: FortnoxVoucher): Promise<FortnoxVoucherResponse> => {
      calls.push(v);
      return { Voucher: { VoucherSeries: v.VoucherSeries, VoucherNumber: 7 } };
    },
  };
  return { client, calls };
}

const semantic: SemanticVoucher = {
  date: "2026-06-11",
  description: "Faktura F-1",
  rows: [
    { role: "kundfordran", debit: 12_500, credit: 0 },
    { role: "intaktArvode", debit: 0, credit: 10_000 },
    { role: "momsUtgaende", debit: 0, credit: 2_500 },
  ],
};

describe("FortnoxLedgerConnector", () => {
  it("deklarerar bara pushVoucher-capability (invariant capability⇔metod håller)", () => {
    const { client } = makeClient();
    const connector = new FortnoxLedgerConnector({ client, mapping: MAPPING });
    expect(connector.name).toBe("fortnox");
    expect(connector.capabilities()).toEqual({
      pushVoucher: true,
      pushInvoice: false,
      pullPayments: false,
      exportSie: false,
    });
    expect(() => assertConnectorMatchesCapabilities(connector)).not.toThrow();
  });

  it("renderar semantiskt verifikat → Fortnox-konton (öre→SEK) och returnerar externalId", async () => {
    const { client, calls } = makeClient();
    const connector = new FortnoxLedgerConnector({ client, mapping: MAPPING });

    const res = await connector.pushVoucher(semantic);

    expect(res).toEqual({ externalId: "A/7" });
    expect(calls).toHaveLength(1);
    const v = calls[0]!;
    expect(v.VoucherSeries).toBe("A");
    expect(v.Description).toBe("Faktura F-1");
    const byAcct = (n: number) => v.VoucherRows.find((r) => r.Account === n)!;
    expect(byAcct(1510)).toMatchObject({ Debit: 125, Credit: 0 });
    expect(byAcct(3041)).toMatchObject({ Debit: 0, Credit: 100 });
    expect(byAcct(2611)).toMatchObject({ Debit: 0, Credit: 25 });
  });
});
