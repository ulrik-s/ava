/**
 * Test för betalfils-importsidan (#181): klistra in camt-XML → förhandsvisning
 * (matchad + granskning) → "Bokför" anropar recordPayment med referens
 * (idempotens) och rätt belopp/datum.
 */

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest-compat";

import PaymentImportPage from "@/app/payments/import/page";
import { buildOcrReference } from "@/lib/shared/ocr-reference";
import { rowOrder, rowWith, sortColumn } from "../../../helpers/data-table";


const OCR = buildOcrReference("20260001");

const mutateAsync = vi.fn().mockResolvedValue({});
const settleAsync = vi.fn().mockResolvedValue({});
const invalidate = vi.fn();
/** Förväntade domstolsfordringar (#175) som sidan matchar fri text mot. */
const receivableCandidates: { data: Array<Record<string, unknown>> } = { data: [] };
// Kuvertform sedan #1014 — sidan läser `data.items`.
const invoiceList = {
  data: {
    items: [
      {
        id: "inv-1", invoiceNumber: "F-2026-0001", ocrReference: OCR,
        amount: 10_000, payments: [] as Array<{ reference: string | null }>,
        matter: { id: "m1", matterNumber: "2026-0001", title: "T" },
      },
      {
        id: "inv-2", invoiceNumber: "F-2026-0002", ocrReference: null,
        amount: 20_000, payments: [],
        matter: { id: "m2", matterNumber: "2026-0002", title: "U" },
      },
    ],
    total: 2,
  },
  isLoading: false,
};

// Dockytan (#1184) kräver en riktig webbläsarlayout — här renderas huvudet och
// alla paneler efter varandra, synkront, så testerna kan granska innehållet.
vi.mock("@/components/layout/panel-page", () => ({
  PanelPage: ({ header, panels }: { header: React.ReactNode; panels: ReadonlyArray<{ id: string; render: () => React.ReactNode }> }) => (
    <>{header}{panels.map((p) => <div key={p.id} data-panel={p.id}>{p.render()}</div>)}</>
  ),
}));

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    // DataTable (#1146) läser/sparar vy-inställningar.
    prefs: {
      get: { useQuery: () => ({ data: undefined, isLoading: false }) },
      save: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clear: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      setOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clearOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    user: { current: { useQuery: () => ({ data: { id: "u1", role: "LAWYER" } }) } },
    useUtils: () => ({
      invoice: { list: { invalidate } },
      expectedReceivable: { candidates: { invalidate }, list: { invalidate } },
    }),
    invoice: {
      list: { useQuery: () => invoiceList },
      recordPayment: { useMutation: () => ({ mutateAsync, isPending: false }) },
    },
    expectedReceivable: {
      candidates: { useQuery: () => receivableCandidates },
      settle: { useMutation: () => ({ mutateAsync: settleAsync, isPending: false }) },
    },
  },
}));

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
  settleAsync.mockClear();
  invalidate.mockClear();
  receivableCandidates.data = [];
  firstInvoice().payments = [];
});

/** Fakturan som CAMT:ens OCR-betalning träffar. */
function firstInvoice(): (typeof invoiceList.data.items)[number] {
  const inv = invoiceList.data.items[0];
  if (!inv) throw new Error("fakturan saknas");
  return inv;
}

/** En inbetalning i camt-filen; `rmt` är innehållet i `<RmtInf>`. */
interface EntrySpec { ref: string; amount: string; date: string; debtor?: string; rmt: string }

function entry(e: EntrySpec): string {
  const debtor = e.debtor ? `<RltdPties><Dbtr><Nm>${e.debtor}</Nm></Dbtr></RltdPties>` : "";
  return `<Ntry><Amt Ccy="SEK">${e.amount}</Amt><CdtDbtInd>CRDT</CdtDbtInd><ValDt><Dt>${e.date}</Dt></ValDt>
    <NtryDtls><TxDtls><Refs><AcctSvcrRef>${e.ref}</AcctSvcrRef></Refs>
    <AmtDtls><TxAmt><Amt Ccy="SEK">${e.amount}</Amt></TxAmt></AmtDtls>${debtor}<RmtInf>${e.rmt}</RmtInf></TxDtls></NtryDtls></Ntry>`;
}

/** En camt.054 med inbetalningarna. */
function camtWith(entries: readonly EntrySpec[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02"><BkToCstmrDbtCdtNtfctn>
  <GrpHdr><MsgId>MSG2</MsgId></GrpHdr><Ntfctn>${entries.map(entry).join("")}</Ntfctn>
</BkToCstmrDbtCdtNtfctn></Document>`;
}

const strd = (ref: string) => `<Strd><CdtrRefInf><Ref>${ref}</Ref></CdtrRefInf></Strd>`;

/** Två domstolsbetalningar med målnummer i fri text + fordringarna de träffar. */
const COURT_CAMT = camtWith([
  { ref: "REF-C1", amount: "300.00", date: "2026-06-03", debtor: "Domstolsverket", rmt: "<Ustrd>T 1111-26</Ustrd>" },
  { ref: "REF-C2", amount: "120.00", date: "2026-06-04", debtor: "Domstolsverket", rmt: "<Ustrd>T 2222-26</Ustrd>" },
]);
const COURT_RECEIVABLES = [
  { id: "er-1", matterNumber: null, courtCaseNumber: "1111-26", expectedAmount: 30_000, description: "Kostnadsräkning Berg" },
  { id: "er-2", matterNumber: null, courtCaseNumber: "2222-26", expectedAmount: 12_000, description: "Kostnadsräkning Alm" },
];

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

  it("vald camt-fil läses in och matchas som inklistrad text", async () => {
    render(<PaymentImportPage />);
    const input = screen.getByLabelText(/Välj camt-fil/);
    Object.defineProperty(input, "files", { value: [new File([CAMT], "camt.xml", { type: "text/xml" })] });
    fireEvent.change(input);
    expect(await screen.findByText("Matchade betalningar (1)")).toBeInTheDocument();
  });

  it("granskningsraden visar den strukturerade referensen när fri text saknas", () => {
    render(<PaymentImportPage />);
    const xml = camtWith([{ ref: "REF-X", amount: "42.00", date: "2026-06-05", rmt: strd("99999999") }]);
    fireEvent.change(screen.getByLabelText("camt-XML"), { target: { value: xml } });
    expect(screen.getByText("Kräver granskning (1)")).toBeInTheDocument();
    expect(screen.getByText("99999999")).toBeInTheDocument();
    expect(screen.getByText("Okänd betalare")).toBeInTheDocument();
  });

  it("matchade betalningar sorteras på varje kolumn", () => {
    render(<PaymentImportPage />);
    const xml = camtWith([
      { ref: "REF-1", amount: "100.00", date: "2026-06-01", debtor: "Bertil AB", rmt: strd(OCR) },
      { ref: "REF-2", amount: "200.00", date: "2026-06-03", debtor: "Anna AB", rmt: strd("F-2026-0002") },
    ]);
    fireEvent.change(screen.getByLabelText("camt-XML"), { target: { value: xml } });
    const debtors = ["Anna AB", "Bertil AB"];
    sortColumn("Faktura", "desc");
    expect(rowOrder(debtors)).toEqual(["Anna AB", "Bertil AB"]);
    sortColumn("Belopp", "asc");
    expect(rowOrder(debtors)).toEqual(["Bertil AB", "Anna AB"]);
    sortColumn("Betalare", "asc");
    expect(rowOrder(debtors)).toEqual(["Anna AB", "Bertil AB"]);
    sortColumn("Datum", "asc");
    expect(rowOrder(debtors)).toEqual(["Bertil AB", "Anna AB"]);
    sortColumn("Matchad via", "asc");
    expect(rowOrder(debtors)).toEqual(["Anna AB", "Bertil AB"]);
  });

  it("domstolsbetalningar föreslås mot förväntade fordringar och sorteras (#175)", () => {
    receivableCandidates.data = COURT_RECEIVABLES;
    render(<PaymentImportPage />);
    fireEvent.change(screen.getByLabelText("camt-XML"), { target: { value: COURT_CAMT } });
    expect(screen.getByText("Domstolsbetalningar — förväntade fordringar (2)")).toBeInTheDocument();
    const labels = ["Kostnadsräkning Berg", "Kostnadsräkning Alm"];
    sortColumn("Fordran", "asc");
    expect(rowOrder(labels)).toEqual(["Kostnadsräkning Alm", "Kostnadsräkning Berg"]);
    sortColumn("Belopp", "desc");
    expect(rowOrder(labels)).toEqual(["Kostnadsräkning Berg", "Kostnadsräkning Alm"]);
  });

  it("Pricka av → settle med utbetalt belopp och referens, listorna laddas om (#175)", async () => {
    receivableCandidates.data = COURT_RECEIVABLES;
    render(<PaymentImportPage />);
    fireEvent.change(screen.getByLabelText("camt-XML"), { target: { value: COURT_CAMT } });
    fireEvent.click(within(rowWith("Kostnadsräkning Berg")).getByRole("button", { name: "Pricka av" }));
    expect(await screen.findByText("Domstolsbetalning avprickad mot fordran.")).toBeInTheDocument();
    expect(settleAsync).toHaveBeenCalledWith({ id: "er-1", settledAmount: 30_000, paymentReference: "REF-C1" });
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("en redan bokförd referens visas som dubblett, inte som matchad (idempotens)", () => {
    firstInvoice().payments = [{ reference: null }, { reference: "REF-A" }];
    render(<PaymentImportPage />);
    fireEvent.change(screen.getByLabelText("camt-XML"), { target: { value: CAMT } });
    expect(screen.getByText("Matchade betalningar (0)")).toBeInTheDocument();
    expect(screen.getByText("Inga matchade betalningar i filen.")).toBeInTheDocument();
    expect(screen.getByText("Redan importerad")).toBeInTheDocument();
  });
});
