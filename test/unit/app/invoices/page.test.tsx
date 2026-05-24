/**
 * Test för InvoicesPage — listrendering, status, tomt-läge.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import InvoicesPage from "@/app/invoices/page";

const invoicesQuery = {
  data: undefined as Array<Record<string, unknown>> | undefined,
  isLoading: false,
};

vi.mock("@/client/lib/trpc", () => ({
  trpc: {
    invoice: {
      list: { useQuery: () => invoicesQuery },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  invoicesQuery.data = undefined;
  invoicesQuery.isLoading = false;
});

describe("InvoicesPage", () => {
  it("renderar rubrik", () => {
    invoicesQuery.data = [];
    render(<InvoicesPage />);
    expect(screen.getByRole("heading", { name: /Fakturor/i })).toBeInTheDocument();
  });

  it("visar laddartext", () => {
    invoicesQuery.isLoading = true;
    render(<InvoicesPage />);
    expect(screen.getByText(/Laddar/i)).toBeInTheDocument();
  });

  it("visar tomt-läge när inga fakturor finns", () => {
    invoicesQuery.data = [];
    render(<InvoicesPage />);
    expect(screen.getByText(/Inga fakturor ännu/i)).toBeInTheDocument();
  });

  it("listar fakturor med status och typ", () => {
    invoicesQuery.data = [
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
    ];
    render(<InvoicesPage />);
    expect(screen.getByText("Faktura")).toBeInTheDocument();
    expect(screen.getByText("Acconto")).toBeInTheDocument();
    expect(screen.getByText("Betald")).toBeInTheDocument();
    expect(screen.getByText("Skickad")).toBeInTheDocument();
    expect(screen.getByText(/2026-0001 — Bodelning/)).toBeInTheDocument();
    expect(screen.getByText(/2026-0002 — Tvist/)).toBeInTheDocument();
  });

  it("länkar varje rad till faktura- och ärendesidor", () => {
    invoicesQuery.data = [
      {
        id: "i1",
        invoiceDate: new Date("2026-02-01").toISOString(),
        invoiceType: "STANDARD",
        status: "DRAFT",
        amount: 1000,
        matter: { id: "m1", matterNumber: "2026-0001", title: "T" },
      },
    ];
    render(<InvoicesPage />);
    const links = screen.getAllByRole("link");
    const hrefs = links.map((l) => l.getAttribute("href"));
    expect(hrefs).toContain("/invoices/i1");
    expect(hrefs).toContain("/matters/m1");
  });

  it("renderar alla statuser med rätt klass-färg", () => {
    invoicesQuery.data = [
      { id: "i1", invoiceDate: new Date().toISOString(), invoiceType: "STANDARD", status: "DRAFT", amount: 100, matter: { id: "m1", matterNumber: "1", title: "T" } },
      { id: "i2", invoiceDate: new Date().toISOString(), invoiceType: "STANDARD", status: "INSTALLMENT_PLAN", amount: 100, matter: { id: "m2", matterNumber: "2", title: "T" } },
      { id: "i3", invoiceDate: new Date().toISOString(), invoiceType: "STANDARD", status: "CANCELLED", amount: 100, matter: { id: "m3", matterNumber: "3", title: "T" } },
      { id: "i4", invoiceDate: new Date().toISOString(), invoiceType: "STANDARD", status: "BAD_DEBT", amount: 100, matter: { id: "m4", matterNumber: "4", title: "T" } },
      { id: "i5", invoiceDate: new Date().toISOString(), invoiceType: "FINAL", status: "SENT", amount: -100, matter: { id: "m5", matterNumber: "5", title: "T" } },
    ];
    render(<InvoicesPage />);
    expect(screen.getByText("Utkast")).toBeInTheDocument();
    expect(screen.getByText("Avbetalningsplan")).toBeInTheDocument();
    expect(screen.getByText("Annullerad")).toBeInTheDocument();
    expect(screen.getByText("Kundförlust")).toBeInTheDocument();
    expect(screen.getByText("Slutfaktura")).toBeInTheDocument();
  });
});
