/**
 * Test för InvoicesPage — listrendering, status, tomt-läge.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import InvoicesPage from "@/app/invoices/page";

// Kuvertform sedan #1014 — sidan läser `data.items`.
const invoicesQuery = {
  data: undefined as { items: Array<Record<string, unknown>>; total: number } | undefined,
  isLoading: false,
};
const setInvoices = (rows: Array<Record<string, unknown>> | undefined): void => {
  invoicesQuery.data = rows === undefined ? undefined : { items: rows, total: rows.length };
};

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ prefs: { get: { invalidate: vi.fn() } } }),
    invoice: {
      list: { useQuery: () => invoicesQuery },
    },
    organization: {
      getSettings: { useQuery: () => ({ data: { name: "Byrå", orgNumber: "5566778899" } }) },
    },
    prefs: {
      get: { useQuery: () => ({ data: undefined, isLoading: false }) },
      save: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clear: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      setOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clearOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    user: {
      current: { useQuery: () => ({ data: { id: "u1", role: "LAWYER" } }) },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  setInvoices(undefined);
  invoicesQuery.isLoading = false;
});

describe("InvoicesPage", () => {
  it("renderar rubrik", () => {
    setInvoices([]);
    render(<InvoicesPage />);
    expect(screen.getByRole("heading", { name: /Fakturor/i })).toBeInTheDocument();
  });

  it("visar laddartext", () => {
    invoicesQuery.isLoading = true;
    render(<InvoicesPage />);
    expect(screen.getByText(/Laddar/i)).toBeInTheDocument();
  });

  it("visar tomt-läge när inga fakturor finns", () => {
    setInvoices([]);
    render(<InvoicesPage />);
    expect(screen.getByText(/Inga fakturor ännu/i)).toBeInTheDocument();
  });

  it("listar fakturor med status och typ", () => {
    setInvoices([
      {
        id: "i1",
        invoiceDate: new Date("2026-02-01").toISOString(),
        invoiceType: "STANDARD",
        status: "PAID",
        amount: 150000,
        matter: { id: "m1", matterNumber: "2026-0001", title: "Bodelning" },
      },
      {
        id: "i2",
        invoiceDate: new Date("2026-02-15").toISOString(),
        invoiceType: "ACCONTO",
        status: "SENT",
        amount: 50000,
        matter: { id: "m2", matterNumber: "2026-0002", title: "Tvist" },
      },
      {
        id: "i3",
        invoiceDate: new Date("2026-02-20").toISOString(),
        invoiceType: "CREDIT",
        status: "DRAFT",
        amount: -10000,
        matter: { id: "m3", matterNumber: "2026-0003", title: "Arv" },
      },
    ]);
    render(<InvoicesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Visa annullerade (1)" })); // kreditfakturan dold från början (#1522)
    expect(screen.getByText("Faktura")).toBeInTheDocument();
    expect(screen.getByText("Aconto")).toBeInTheDocument();
    expect(screen.getByText("Kreditfaktura")).toBeInTheDocument(); // förr rått "CREDIT" (#1309)
    expect(screen.queryByText("CREDIT")).toBeNull();
    expect(screen.getByText("Betald")).toBeInTheDocument();
    expect(screen.getByText("Skickad")).toBeInTheDocument();
    expect(screen.getByText(/2026-0001 — Bodelning/)).toBeInTheDocument();
    expect(screen.getByText(/2026-0002 — Tvist/)).toBeInTheDocument();
  });

  it("länkar varje rad till faktura- och ärendesidor", () => {
    setInvoices([
      {
        id: "i1",
        invoiceDate: new Date("2026-02-01").toISOString(),
        invoiceType: "STANDARD",
        status: "DRAFT",
        amount: 1000,
        matter: { id: "m1", matterNumber: "2026-0001", title: "T" },
      },
    ]);
    render(<InvoicesPage />);
    const links = screen.getAllByRole("link");
    const hrefs = links.map((l) => l.getAttribute("href"));
    // Både faktura- och ärende-länken renderas nu som Next-<Link> till den
    // förrenderade __shell__-routen med ?id=<id> (soft-nav), så runtime-skapade
    // id:n funkar utan egen prerender. Base-path är tomt i testmiljön.
    expect(hrefs).toContain("/invoices/__shell__?id=i1");
    expect(hrefs).toContain("/matters/__shell__?id=m1");
    // ...och INTE en direkt /<route>/<id>-länk.
    expect(hrefs).not.toContain("/invoices/i1/");
    expect(hrefs).not.toContain("/matters/m1/");
  });

  it("renderar alla statuser med rätt klass-färg", () => {
    setInvoices([
      { id: "i1", invoiceDate: new Date().toISOString(), invoiceType: "STANDARD", status: "DRAFT", amount: 100, matter: { id: "m1", matterNumber: "1", title: "T" } },
      { id: "i2", invoiceDate: new Date().toISOString(), invoiceType: "STANDARD", status: "INSTALLMENT_PLAN", amount: 100, matter: { id: "m2", matterNumber: "2", title: "T" } },
      { id: "i3", invoiceDate: new Date().toISOString(), invoiceType: "STANDARD", status: "CANCELLED", amount: 100, matter: { id: "m3", matterNumber: "3", title: "T" } },
      { id: "i4", invoiceDate: new Date().toISOString(), invoiceType: "STANDARD", status: "BAD_DEBT", amount: 100, matter: { id: "m4", matterNumber: "4", title: "T" } },
      { id: "i5", invoiceDate: new Date().toISOString(), invoiceType: "FINAL", status: "SENT", amount: -100, matter: { id: "m5", matterNumber: "5", title: "T" } },
    ]);
    render(<InvoicesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Visa annullerade (1)" })); // annullerad dold från början (#1522)
    expect(screen.getByText("Skapad")).toBeInTheDocument();
    expect(screen.getByText("Avbetalningsplan")).toBeInTheDocument();
    expect(screen.getByText("Annullerad")).toBeInTheDocument();
    expect(screen.getByText("Kundförlust")).toBeInTheDocument();
    expect(screen.getByText("Slutfaktura")).toBeInTheDocument();
  });

  describe("annullerade och kreditfakturor dolda från början (#1522)", () => {
    const row = (id: string, status: string, invoiceType: string, amount: number): Record<string, unknown> => ({
      id, invoiceNumber: `F-${id}`, invoiceDate: new Date("2026-03-01").toISOString(), invoiceType, status, amount,
      matter: { id: "m1", matterNumber: "2026-0001", title: "T" },
    });
    const mixed = (): void => setInvoices([
      row("1", "SENT", "STANDARD", 100000),
      row("2", "CANCELLED", "STANDARD", 40000),
      row("3", "DRAFT", "CREDIT", -40000),
      row("4", "PAID", "FINAL", 25000),
    ]);
    const footer = (container: HTMLElement): string => container.querySelector("tfoot")?.textContent ?? "";

    it("döljer annullerade och kreditfakturor och visar antalet på knappen", () => {
      mixed();
      render(<InvoicesPage />);
      expect(screen.getByText("F-1")).toBeInTheDocument();
      expect(screen.getByText("F-4")).toBeInTheDocument();
      expect(screen.queryByText("F-2")).toBeNull();
      expect(screen.queryByText("F-3")).toBeNull();
      expect(screen.getByRole("button", { name: "Visa annullerade (2)" })).toBeInTheDocument();
    });

    it("klick visar de dolda med sin status och byter text; nytt klick döljer igen", () => {
      mixed();
      render(<InvoicesPage />);
      fireEvent.click(screen.getByRole("button", { name: "Visa annullerade (2)" }));
      expect(screen.getByText("F-2")).toBeInTheDocument();
      expect(screen.getByText("F-3")).toBeInTheDocument();
      expect(screen.getByText("Annullerad")).toBeInTheDocument();
      expect(screen.getByText("Kreditfaktura")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Dölj annullerade" }));
      expect(screen.queryByText("F-2")).toBeNull();
    });

    it("summeringen räknar bara synliga rader", () => {
      setInvoices([row("1", "SENT", "STANDARD", 100000), row("2", "CANCELLED", "STANDARD", 40000)]);
      const { container } = render(<InvoicesPage />);
      expect(footer(container)).toMatch(/1\s?000/);
      fireEvent.click(screen.getByRole("button", { name: "Visa annullerade (1)" }));
      expect(footer(container)).toMatch(/1\s?400/);
    });

    it("ingen knapp när inget är dolt", () => {
      setInvoices([row("1", "SENT", "STANDARD", 100000)]);
      render(<InvoicesPage />);
      expect(screen.queryByRole("button", { name: /annullerade/ })).toBeNull();
    });
  });
});
