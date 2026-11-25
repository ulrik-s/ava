import { describe, it, expect } from "vitest-compat";
import type { FortnoxClient } from "@/lib/server/integrations/fortnox/client";
import { FortnoxLedgerConnector, MISSING_YEAR } from "@/lib/server/integrations/fortnox/connector";
import type { FortnoxKontoMappning, FortnoxVoucher, FortnoxVoucherResponse } from "@/lib/server/integrations/fortnox/schema";
import { assertConnectorMatchesCapabilities } from "@/lib/server/integrations/ledger/capabilities";
import type { SemanticVoucher } from "@/lib/shared/accounting/semantic-voucher";

const MAPPING: FortnoxKontoMappning = {
  voucherSeries: "A",
  kundfordran: "1510",
  intaktArvode: "3041",
  momsUtgaende: "2611",
};

function makeClient() {
  const calls: FortnoxVoucher[] = [];
  const uploads: Array<{ fileName: string; size: number }> = [];
  const connections: Array<{ fileId: string; series: string; number: string; year: number }> = [];
  const client: Pick<FortnoxClient, "createVoucher" | "uploadInboxFile" | "connectFileToVoucher"> = {
    createVoucher: async (v: FortnoxVoucher): Promise<FortnoxVoucherResponse> => {
      calls.push(v);
      return { Voucher: { VoucherSeries: v.VoucherSeries, VoucherNumber: 7, Year: 4 } };
    },
    uploadInboxFile: async (fileName: string, bytes: Uint8Array): Promise<string> => {
      uploads.push({ fileName, size: bytes.length });
      return "file-guid-1";
    },
    connectFileToVoucher: async (fileId: string, series: string, number: string, year: number): Promise<void> => {
      connections.push({ fileId, series, number, year });
    },
  };
  return { client, calls, uploads, connections };
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

  it("bifogar faktura-PDF till konteringen när attachment finns (#785)", async () => {
    const { client, uploads, connections } = makeClient();
    const connector = new FortnoxLedgerConnector({ client, mapping: MAPPING });

    const res = await connector.pushVoucher(semantic, {
      idempotencyKey: "br-1",
      attachment: { fileName: "Faktura AA2026-0001.pdf", bytes: new Uint8Array([1, 2, 3, 4]) },
    });

    expect(res).toEqual({ externalId: "A/7" });
    expect(uploads).toEqual([{ fileName: "Faktura AA2026-0001.pdf", size: 4 }]);
    // Filen kopplas till det skapade verifikatet (serie/nummer/räkenskapsår från svaret, #1886).
    expect(connections).toEqual([{ fileId: "file-guid-1", series: "A", number: "7", year: 4 }]);
  });

  // #1886: serie + nummer är unika bara inom ett räkenskapsår — utan Year ingen bilaga.
  it("utan Year i svaret laddas ingenting upp, och skälet står i attachmentError", async () => {
    const { client, uploads, connections } = makeClient();
    client.createVoucher = (v) => Promise.resolve({ Voucher: { VoucherSeries: v.VoucherSeries, VoucherNumber: 7 } });
    const connector = new FortnoxLedgerConnector({ client, mapping: MAPPING });
    const res = await connector.pushVoucher(semantic, { idempotencyKey: "br-1", attachment: { fileName: "F.pdf", bytes: new Uint8Array([1]) } });
    expect(res).toEqual({ externalId: "A/7", attachmentError: MISSING_YEAR });
    expect(uploads).toHaveLength(0);
    expect(connections).toHaveLength(0);
  });

  // #1885: verifikatet finns redan — ett fel med bilagan kastas inte, det blir ett skäl.
  it("en uppladdning som kastar ger ändå verifikatet, med skälet i attachmentError", async () => {
    const { client, connections } = makeClient();
    client.uploadInboxFile = () => Promise.reject(new Error("Fortnox: 500 inkorgen nere"));
    const connector = new FortnoxLedgerConnector({ client, mapping: MAPPING });
    const res = await connector.pushVoucher(semantic, { idempotencyKey: "br-1", attachment: { fileName: "F.pdf", bytes: new Uint8Array([1]) } });
    expect(res).toEqual({ externalId: "A/7", attachmentError: "Fortnox: 500 inkorgen nere" });
    expect(connections).toHaveLength(0);
  });

  it("en koppling som kastar ger ändå verifikatet, med skälet i attachmentError", async () => {
    const { client, uploads } = makeClient();
    client.connectFileToVoucher = () => Promise.reject(new Error("koppling nekad"));
    const connector = new FortnoxLedgerConnector({ client, mapping: MAPPING });
    const res = await connector.pushVoucher(semantic, { idempotencyKey: "br-1", attachment: { fileName: "F.pdf", bytes: new Uint8Array([1]) } });
    expect(res).toEqual({ externalId: "A/7", attachmentError: "koppling nekad" });
    expect(uploads).toHaveLength(1);
  });

  it("ett fel i createVoucher kastar som förut, och ingen fil laddas upp", async () => {
    const { client, uploads } = makeClient();
    client.createVoucher = () => Promise.reject(new Error("Fortnox: 400 Felaktig datastruktur"));
    const connector = new FortnoxLedgerConnector({ client, mapping: MAPPING });
    await expect(connector.pushVoucher(semantic, { idempotencyKey: "br-1", attachment: { fileName: "F.pdf", bytes: new Uint8Array([1]) } }))
      .rejects.toThrow(/400/);
    expect(uploads).toHaveLength(0);
  });

  it("utan attachment laddas ingen fil upp", async () => {
    const { client, uploads, connections } = makeClient();
    const connector = new FortnoxLedgerConnector({ client, mapping: MAPPING });
    await connector.pushVoucher(semantic, { idempotencyKey: "br-1" });
    expect(uploads).toHaveLength(0);
    expect(connections).toHaveLength(0);
  });
});
