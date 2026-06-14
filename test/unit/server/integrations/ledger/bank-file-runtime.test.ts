import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest-compat";
import { buildBankFilePaymentsJob, CAMT_INBOX_ENV } from "@/lib/server/integrations/ledger/bank-file-runtime";
import type { PaymentsJobCaller, PayableInvoice } from "@/lib/server/integrations/ledger/payments-job";

const OCR = "2026004206";
const camt = `<?xml version="1.0" encoding="UTF-8"?>
<Document><BkToCstmrDbtCdtNtfctn>
  <GrpHdr><MsgId>M1</MsgId></GrpHdr>
  <Ntfctn><Ntry>
    <Amt Ccy="SEK">125.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><ValDt><Dt>2026-06-01</Dt></ValDt>
    <NtryDtls><TxDtls>
      <Refs><AcctSvcrRef>TX-A</AcctSvcrRef></Refs>
      <RmtInf><Strd><CdtrRefInf><Ref>${OCR}</Ref></CdtrRefInf></Strd></RmtInf>
    </TxDtls></NtryDtls>
  </Ntry></Ntfctn>
</BkToCstmrDbtCdtNtfctn></Document>`;

const INV: PayableInvoice = { id: "inv-1", ocrReference: OCR, payments: [] };

function makeCaller() {
  const recorded: Array<{ invoiceId: string; reference?: string }> = [];
  const caller: PaymentsJobCaller = {
    invoice: {
      list: async () => [INV],
      recordPayment: async (input) => { recorded.push(input); return {}; },
    },
  };
  return { caller, recorded };
}

describe("buildBankFilePaymentsJob", () => {
  it("returnerar null när inkorgen inte är konfigurerad", () => {
    expect(buildBankFilePaymentsJob({ env: {}, log: () => {} })).toBeNull();
  });

  it("läser camt-filer ur inkorgen och prickar av via porten", async () => {
    const dir = mkdtempSync(join(tmpdir(), "camt-inbox-"));
    try {
      writeFileSync(join(dir, "betalning.xml"), camt, "utf8");
      writeFileSync(join(dir, "ignore.txt"), "skräp", "utf8");
      const job = buildBankFilePaymentsJob({ env: { [CAMT_INBOX_ENV]: dir }, log: () => {} });
      expect(job).not.toBeNull();
      const j = job!;

      const { caller, recorded } = makeCaller();
      await j.act(caller as unknown as Parameters<typeof j.act>[0]);
      expect(recorded).toEqual([{ invoiceId: "inv-1", amount: 12_500, paidAt: "2026-06-01", note: "Bankfil-avprickning", reference: "TX-A" }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("saknad inkorg-katalog → inga betalningar (ingen krasch)", async () => {
    const job = buildBankFilePaymentsJob({ env: { [CAMT_INBOX_ENV]: join(tmpdir(), "finns-inte-xyz") }, log: () => {} });
    const j = job!;
    const { caller, recorded } = makeCaller();
    await j.act(caller as unknown as Parameters<typeof j.act>[0]);
    expect(recorded).toHaveLength(0);
  });
});
