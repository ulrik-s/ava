/**
 * Test för betalfils-importsidan (#181): klistra in camt-XML → förhandsvisning
 * (matchad + granskning) → "Bokför" anropar recordPayment med referens
 * (idempotens) och rätt belopp/datum.
 */

import { describe, it, expect, beforeEach, vi } from "vitest-compat";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { buildOcrReference } from "@/lib/shared/ocr-reference";

const OCR = buildOcrReference("20260001");

const mutateAsync = vi.fn().mockResolvedValue({});
const invalidate = vi.fn();
const invoiceList = {
  data: [
    {
      id: "inv-1", invoiceNumber: "F-2026-0001", ocrReference: OCR,
      amount: 10_000, payments: [],
      matter: { id: "m1", matterNumber: "2026-0001", title: "T" },
    },
  ],
  isLoading: false,
};

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({
      invoice: { list: { invalidate } },
      expectedReceivable: { candidates: { invalidate }, list: { invalidate } },
    }),
    invoice: {
      list: { useQuery: () => invoiceList },
      recordPayment: { useMutation: () => ({ mutateAsync, isPending: false }) },
    },
    expectedReceivable: {
      candidates: { useQuery: () => ({ data: [] as Array<Record<string, unknown>> }) },
      settle: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
  },
}));

import PaymentImportPage from "@/app/payments/import/page";

/** Minimal camt.054: en CRDT-Ntry med en TxDtls som bär OCR:en + en omatchbar. */
const CAMT = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02">
  <BkToCstmrDbtCdtNtfctn>
    <GrpHdr><MsgId>MSG1</MsgId></GrpHdr>
    <Ntfctn>
      <Ntry>
        <Amt Ccy="SEK">100.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <ValDt><Dt>2026-06-01</Dt></ValDt>
        <NtryDtls>
          <TxDtls>
            <Refs><AcctSvcrRef>REF-A</AcctSvcrRef></Refs>
            <AmtDtls><TxAmt><Amt Ccy="SEK">100.00</Amt></TxAmt></AmtDtls>
            <RltdPties><Dbtr><Nm>Klient AB</Nm></Dbtr></RltdPties>
            <RmtInf><Strd><CdtrRefInf><Ref>${OCR}</Ref></CdtrRefInf></Strd></RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="SEK">55.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <ValDt><Dt>2026-06-02</Dt></ValDt>
        <NtryDtls>
          <TxDtls>
            <Refs><AcctSvcrRef>REF-B</AcctSvcrRef></Refs>
            <AmtDtls><TxAmt><Amt Ccy="SEK">55.00</Amt></TxAmt></AmtDtls>
            <RltdPties><Dbtr><Nm>Domstolsverket</Nm></Dbtr></RltdPties>
            <RmtInf><Ustrd>T 1234-26</Ustrd></RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
    </Ntfctn>
  </BkToCstmrDbtCdtNtfctn>
</Document>`;

beforeEach(() => {
  mutateAsync.mockClear();
  invalidate.mockClear();
});

describe("PaymentImportPage (#181)", () => {
  it("tom start: rubrik + filväljare, ingen förhandsvisning", () => {
    render(<PaymentImportPage />);
    expect(screen.getByText("Importera betalfil")).toBeInTheDocument();
    expect(screen.queryByText(/Matchade betalningar/)).not.toBeInTheDocument();
  });

  it("inklistrad camt → matchad rad (OCR) + granskningsrad (fri text utan träff)", () => {
    render(<PaymentImportPage />);
    fireEvent.change(screen.getByLabelText("camt-XML"), { target: { value: CAMT } });

    expect(screen.getByText("Matchade betalningar (1)")).toBeInTheDocument();
    expect(screen.getByText("F-2026-0001")).toBeInTheDocument();
    expect(screen.getByText("OCR")).toBeInTheDocument();
    expect(screen.getByText("Kräver granskning (1)")).toBeInTheDocument();
    expect(screen.getByText("Domstolsverket")).toBeInTheDocument();
    expect(screen.getByText("Ingen träff — koppla manuellt")).toBeInTheDocument();
  });

  it("Bokför → recordPayment med referens, belopp och valutadatum + invalidate", async () => {
    render(<PaymentImportPage />);
    fireEvent.change(screen.getByLabelText("camt-XML"), { target: { value: CAMT } });
    fireEvent.click(screen.getByRole("button", { name: /Bokför 1 betalningar/ }));

    await waitFor(() => expect(screen.getByText(/bokförda\./)).toBeInTheDocument());
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith({
      invoiceId: "inv-1",
      amount: 10_000,
      paidAt: "2026-06-01",
      note: "Betalfils-import — Klient AB",
      reference: "REF-A",
    });
    expect(invalidate).toHaveBeenCalled();
  });

  it("ogiltig XML → felmeddelande, inget bokfört", () => {
    render(<PaymentImportPage />);
    fireEvent.change(screen.getByLabelText("camt-XML"), { target: { value: "<foo/>" } });
    expect(screen.getByText(/Kunde inte läsa filen/)).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
