/**
 * Tester för `BillingPanel` (#27) — översikts-/action-panelen per ärende.
 *
 * Täcker de rena hjälparna (computeTotals, optionsFor, findPendingVerdict,
 * clientOf/courtOf) via render + de villkorade vyerna: summa-kort, runs-lista,
 * pending-verdict-banner, rådgivnings-banner (rättshjälp) och "+ Skapa
 * faktura"-menyn vars alternativ beror på matter:s paymentMethod. Barn-
 * dialogerna stubbas (de har egna tester) så panelens egen logik isoleras.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { BillingPanel } from "@/app/matters/[id]/_billing-panel";

interface BillingRunRow {
  id: string; type: string; status: string; recipient: string;
  amountOre: number; createdAt: string | Date;
  invoiceId?: string | null; invoice?: { id: string; invoiceNumber?: string | null } | null;
}

let runsData: { runs: BillingRunRow[] } = { runs: [] };
let runsLoading = false;
interface ProposalData { workValueOre: number; priorAccontoSumOre: number; timeEntries: Array<{ id: string; description: string; minutes: number; hourlyRate: number; billable: boolean; valueOre: number }>; expenses: Array<{ id: string; description: string; amount: number; billable: boolean }> }
let proposalData: ProposalData = { workValueOre: 0, priorAccontoSumOre: 0, timeEntries: [], expenses: [] };
const refetch = vi.fn();
const radgivningMutate = vi.fn();
const krMutate = vi.fn();
let documentListData: { documents: Array<Record<string, unknown>> } = { documents: [] };
let hasDoc = false;
const openGeneratedDocFn = vi.fn();

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    billingRun: {
      list: { useQuery: () => ({ data: runsData, isLoading: runsLoading, refetch }) },
      proposal: { useQuery: () => ({ data: proposalData, isLoading: false }) },
      createKostnadsrakning: { useMutation: () => ({ mutate: krMutate, isPending: false }) },
    },
    organization: {
      getSettings: { useQuery: () => ({ data: { name: "Byrå AB", orgNumber: "556677-8899", address: "Storgatan 1" } }) },
    },
    user: { current: { useQuery: () => ({ data: { name: "Adv. Anna", email: "anna@byra.se" } }) } },
    expense: { list: { useQuery: () => ({ data: { expenses: [] } }) } },
    document: { list: { useQuery: () => ({ data: documentListData }) } },
    invoice: {
      createRadgivning: {
        useMutation: (opts?: { onSuccess?: () => void }) => {
          void opts;
          return { mutate: radgivningMutate, isPending: false };
        },
      },
    },
  },
}));

vi.mock("@/lib/client/diagnostics/use-matter-invariants", () => ({ useMatterInvariants: vi.fn() }));
vi.mock("@/lib/client/demo/entity-link", () => ({
  EntityLink: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));
vi.mock("@/lib/client/demo/generated-doc-cache", () => ({
  hasGeneratedDoc: () => hasDoc,
  openGeneratedDoc: (id: string) => openGeneratedDocFn(id),
}));
vi.mock("@/app/matters/[id]/_billing-dialog", () => ({
  BillingDialog: ({ type }: { type: string }) => <div data-testid="billing-dialog">{type}</div>,
}));
vi.mock("@/app/matters/[id]/_verdict-dialog", () => ({
  VerdictDialog: () => <div data-testid="verdict-dialog" />,
}));
vi.mock("@/app/matters/[id]/_kostnadsrakning-modal", () => ({
  KostnadsrakningModal: () => <div data-testid="kr-modal" />,
}));

const baseMatter = {
  matterNumber: "2026-0001",
  title: "Tvist mot motpart",
  contacts: [
    { role: "KLIENT", contact: { name: "Anna Andersson", email: "anna@klient.se" } },
    { role: "DOMSTOL", contact: { name: "Stockholms tingsrätt" } },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  runsData = { runs: [] };
  runsLoading = false;
  documentListData = { documents: [] };
  proposalData = { workValueOre: 0, priorAccontoSumOre: 0, timeEntries: [], expenses: [] };
  hasDoc = false;
});

describe("BillingPanel — översikt", () => {
  it("renderar rubrik och tomtext utan runs", () => {
    render(<BillingPanel matterId="m1" matter={baseMatter} />);
    expect(screen.getByText("Fakturering")).toBeInTheDocument();
    expect(screen.getByText("Inga billing-runs ännu.")).toBeInTheDocument();
  });

  it("visar laddtext medan runs hämtas", () => {
    runsLoading = true;
    render(<BillingPanel matterId="m1" matter={baseMatter} />);
    expect(screen.getByText("Laddar…")).toBeInTheDocument();
  });

  it("summerar acconto/fakturerat/väntar-på-dom korrekt (computeTotals)", () => {
    runsData = {
      runs: [
        { id: "r1", type: "ACCONTO", status: "SENT", recipient: "KLIENT", amountOre: 100_000, createdAt: "2026-01-01", invoiceId: "inv-1", invoice: { id: "inv-1", invoiceNumber: "F-1" } },
        { id: "r2", type: "FINAL", status: "SENT", recipient: "KLIENT", amountOre: 250_000, createdAt: "2026-02-01" },
        { id: "r3", type: "KOSTNADSRAKNING", status: "PENDING_VERDICT", recipient: "DOMSTOL", amountOre: 50_000, createdAt: "2026-03-01" },
      ],
    };
    render(<BillingPanel matterId="m1" matter={baseMatter} />);
    // Aconto = 1000 kr, Fakturerat = 2500 kr, Väntar = 500 kr. Varje belopp
    // syns två gånger (summa-kort + run-rad); Intl använder no-break-space
    // → matcha tolerant via regex + getAllByText.
    expect(screen.getAllByText(/1\s*000,00/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/2\s*500,00/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Aconto fakturerat")).toBeInTheDocument();
    // Faktura-länk för run med invoiceId (EntityLink-stub)
    expect(screen.getByText("F-1")).toBeInTheDocument();
  });
});

describe("BillingPanel — Upparbetat ofakturerat", () => {
  it("visar arvode/utlägg/total när det finns ofakturerat debiterbart arbete", () => {
    proposalData = {
      workValueOre: 120_000,
      priorAccontoSumOre: 0,
      timeEntries: [
        { id: "t1", description: "Arbete", minutes: 60, hourlyRate: 1200, billable: true, valueOre: 120_000 },
        { id: "t2", description: "Ej deb", minutes: 30, hourlyRate: 1200, billable: false, valueOre: 60_000 },
      ],
      expenses: [
        { id: "e1", description: "Ansökningsavgift", amount: 90_000, billable: true },
        { id: "e2", description: "Ej deb", amount: 10_000, billable: false },
      ],
    };
    render(<BillingPanel matterId="m1" matter={baseMatter} />);
    expect(screen.getByText("Upparbetat ofakturerat")).toBeInTheDocument();
    // Arvode 1200,00 (bara billable), Utlägg 900,00, Total 2100,00.
    expect(screen.getByText(/1\s*200,00/)).toBeInTheDocument();
    expect(screen.getByText(/900,00/)).toBeInTheDocument();
    expect(screen.getByText(/2\s*100,00/)).toBeInTheDocument();
  });

  it("visar tomtext när inget ofakturerat finns", () => {
    render(<BillingPanel matterId="m1" matter={baseMatter} />);
    expect(screen.getByText("Upparbetat ofakturerat")).toBeInTheDocument();
    expect(screen.getByText(/Inget ofakturerat/)).toBeInTheDocument();
  });
});

describe("BillingPanel — pending verdict", () => {
  beforeEach(() => {
    runsData = {
      runs: [
        { id: "r3", type: "KOSTNADSRAKNING", status: "PENDING_VERDICT", recipient: "DOMSTOL", amountOre: 50_000, createdAt: "2026-03-01" },
      ],
    };
  });

  it("visar banner och öppnar verdict-dialogen", () => {
    render(<BillingPanel matterId="m1" matter={baseMatter} />);
    expect(screen.getByText(/Kostnadsräkning väntar på dom/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Ange dom \+ prutning/ }));
    expect(screen.getByTestId("verdict-dialog")).toBeInTheDocument();
  });

  it("öppnar KR-dokumentet ur blob-cachen när det finns", () => {
    documentListData = { documents: [{ id: "doc-1", fileName: "kostnadsrakning.docx", documentType: "Kostnadsräkning", createdAt: "2026-03-01" }] };
    hasDoc = true;
    render(<BillingPanel matterId="m1" matter={baseMatter} />);
    fireEvent.click(screen.getByRole("button", { name: "kostnadsrakning.docx" }));
    expect(openGeneratedDocFn).toHaveBeenCalledWith("doc-1");
  });

  it("varnar när KR-dokumentet inte längre är i minnet", () => {
    documentListData = { documents: [{ id: "doc-1", fileName: "kostnadsrakning.docx", documentType: "Kostnadsräkning", createdAt: "2026-03-01" }] };
    hasDoc = false;
    const alertSpy = vi.spyOn(globalThis, "alert").mockImplementation(() => {});
    render(<BillingPanel matterId="m1" matter={baseMatter} />);
    fireEvent.click(screen.getByRole("button", { name: "kostnadsrakning.docx" }));
    expect(alertSpy).toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});

describe("BillingPanel — Skapa-faktura-menyn (optionsFor)", () => {
  it("PRIVAT-default: bara 'Faktura till klient' → öppnar FINAL-dialogen", () => {
    render(<BillingPanel matterId="m1" matter={{ ...baseMatter, paymentMethod: "PRIVAT" }} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Skapa faktura" }));
    fireEvent.click(screen.getByRole("button", { name: "Faktura till klient" }));
    expect(screen.getByTestId("billing-dialog")).toHaveTextContent("FINAL");
  });

  it("RATTSSKYDD: aconto + faktura till försäkring", () => {
    render(<BillingPanel matterId="m1" matter={{ ...baseMatter, paymentMethod: "RATTSSKYDD" }} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Skapa faktura" }));
    expect(screen.getByRole("button", { name: "Aconto till klient" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Faktura till försäkring" })).toBeInTheDocument();
  });

  it("OFFENTLIGT_UPPDRAG: kostnadsräkning → öppnar KR-modalen", () => {
    render(<BillingPanel matterId="m1" matter={{ ...baseMatter, paymentMethod: "OFFENTLIGT_UPPDRAG" }} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Skapa faktura" }));
    fireEvent.click(screen.getByRole("button", { name: "Kostnadsräkning till domstol" }));
    expect(screen.getByTestId("kr-modal")).toBeInTheDocument();
  });
});

describe("BillingPanel — rådgivnings-banner (rättshjälp)", () => {
  it("RATTSHJALP utan registrerad rådgivning → knappen registrerar", () => {
    render(<BillingPanel matterId="m1" matter={{ ...baseMatter, paymentMethod: "RATTSHJALP" }} />);
    expect(screen.getByText(/Rådgivningstimme \(rättshjälp\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Registrera betald" }));
    expect(radgivningMutate).toHaveBeenCalledWith(expect.objectContaining({ matterId: "m1" }));
  });

  it("RATTSHJALP med registrerad rådgivning → visar bock", () => {
    render(<BillingPanel matterId="m1" matter={{ ...baseMatter, paymentMethod: "RATTSHJALP", radgivningBetaldAt: "2026-01-05" }} />);
    expect(screen.getByText(/Registrerad/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Registrera betald" })).not.toBeInTheDocument();
  });

  it("icke-rättshjälp → ingen rådgivnings-banner", () => {
    render(<BillingPanel matterId="m1" matter={{ ...baseMatter, paymentMethod: "PRIVAT" }} />);
    expect(screen.queryByText(/Rådgivningstimme/)).not.toBeInTheDocument();
  });
});
