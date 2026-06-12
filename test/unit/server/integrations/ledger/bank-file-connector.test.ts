import { describe, it, expect } from "vitest-compat";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BankFileLedgerConnector } from "@/lib/server/integrations/ledger/bank-file-connector";
import { assertConnectorMatchesCapabilities } from "@/lib/server/integrations/ledger/capabilities";
import { ledgerPaymentSchema } from "@/lib/server/integrations/ledger/port";

const FIXTURES = resolve(__dirname, "../../../../fixtures/camt-seb");
const read = (f: string): string => readFileSync(resolve(FIXTURES, f), "utf8");

const connectorFor = (...files: string[]) =>
  new BankFileLedgerConnector({ loadCamtFiles: async () => files });

/** Minimal camt.054 med två Strd-referenser: ett dokumentnr + en giltig OCR. */
const OCR = "2026004206"; // buildOcrReference("20260042"), validerar mod-10
const camtWithOcr = `<?xml version="1.0" encoding="UTF-8"?>
<Document>
  <BkToCstmrDbtCdtNtfctn>
    <GrpHdr><MsgId>MSG-1</MsgId></GrpHdr>
    <Ntfctn>
      <Ntry>
        <Amt Ccy="SEK">125.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <ValDt><Dt>2026-06-01</Dt></ValDt>
        <NtryDtls><TxDtls>
          <Refs><AcctSvcrRef>TX-OCR-1</AcctSvcrRef></Refs>
          <RltdPties><Dbtr><Nm>Klient AB</Nm></Dbtr></RltdPties>
          <RmtInf>
            <Strd><RfrdDocInf><Nb>98547</Nb></RfrdDocInf></Strd>
            <Strd><CdtrRefInf><Ref>${OCR}</Ref></CdtrRefInf></Strd>
          </RmtInf>
        </TxDtls></NtryDtls>
      </Ntry>
    </Ntfctn>
  </BkToCstmrDbtCdtNtfctn>
</Document>`;

describe("BankFileLedgerConnector", () => {
  it("deklarerar bara pullPayments-capability (invariant capability⇔metod håller)", () => {
    const connector = connectorFor();
    expect(connector.name).toBe("bankfil-camt");
    expect(connector.capabilities()).toEqual({
      pushVoucher: false,
      pushInvoice: false,
      pullPayments: true,
      exportSie: false,
    });
    expect(() => assertConnectorMatchesCapabilities(connector)).not.toThrow();
  });

  it("parsar camt.054-fil → LedgerPayments (CRDT, belopp i öre, payerName)", async () => {
    const payments = await connectorFor(read("camt.054_SE_CRED_BGC.xml")).pullPayments({ since: "2026-01-01" });
    expect(payments).toHaveLength(2);
    expect(payments.every((p) => ledgerPaymentSchema.safeParse(p).success)).toBe(true);
    expect(payments[0]).toMatchObject({ externalId: "STOIIQ0I220505085240644513000001", amount: 100_00, payerName: "Debtor" });
  });

  it("väljer en giltig OCR-referens framför ett dokumentnummer", async () => {
    const [payment] = await connectorFor(camtWithOcr).pullPayments({ since: "2026-01-01" });
    expect(payment).toMatchObject({ externalId: "TX-OCR-1", amount: 125_00, ocrReference: OCR, date: "2026-06-01" });
  });

  it("dedupar på externalId över överlappande filer (idempotent)", async () => {
    const once = await connectorFor(camtWithOcr).pullPayments({ since: "2026-01-01" });
    const twice = await connectorFor(camtWithOcr, camtWithOcr).pullPayments({ since: "2026-01-01" });
    expect(twice).toHaveLength(once.length);
  });

  it("tom källa → inga betalningar", async () => {
    expect(await connectorFor().pullPayments({ since: "2026-01-01" })).toEqual([]);
  });

  it("fri-text-fil (inga strukturerade refs) → betalningar utan ocrReference", async () => {
    const payments = await connectorFor(read("camt.054_SE.xml")).pullPayments({ since: "2026-01-01" });
    expect(payments.length).toBeGreaterThan(0);
    expect(payments.every((p) => p.ocrReference === undefined)).toBe(true);
  });
});
