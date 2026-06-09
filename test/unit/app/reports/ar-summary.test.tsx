/**
 * Test för ArSummarySection (ADR 0007): brygga + åldersanalys renderas.
 */

import { describe, it, expect, beforeEach, vi } from "vitest-compat";
import { render, screen } from "@testing-library/react";

const arQuery = { data: undefined as Record<string, unknown> | undefined, isLoading: false };

vi.mock("@/lib/client/trpc", () => ({
  trpc: { reports: { arSummary: { useQuery: () => arQuery } } },
}));

import { ArSummarySection } from "@/app/reports/_ar-summary";

beforeEach(() => {
  arQuery.data = undefined;
  arQuery.isLoading = false;
});

describe("ArSummarySection", () => {
  it("visar laddningsläge", () => {
    arQuery.isLoading = true;
    render(<ArSummarySection from="2026-01-01" to="2026-06-30" />);
    expect(screen.getByText("Laddar…")).toBeInTheDocument();
  });

  it("renderar bryggan + åldersanalysen", () => {
    arQuery.data = {
      bridge: {
        fakturerat: 1_700_00, krediterat: 100_00, justerat: 1_600_00,
        inbetalt: 850_00, konstateradKundforlust: 150_00,
        utestaende: 600_00, ejForfallet: 200_00, forfallet: 400_00,
        nettoRealiserat: 1_450_00,
      },
      aging: [
        { label: "0–30 dagar", amount: 100_00 },
        { label: "31–60 dagar", amount: 0 },
        { label: "61–90 dagar", amount: 0 },
        { label: ">90 dagar", amount: 300_00 },
      ],
      rows: [
        { id: "i1", invoiceDate: "2026-03-10", matterId: "m1", matterNumber: "2026-0001", title: "Tvist", fakturerat: 100_00, inbetalt: 30_00, avskrivet: 0, utestaende: 70_00 },
      ],
    };
    render(<ArSummarySection from="2026-01-01" to="2026-06-30" />);
    expect(screen.getByText("Kundfordringar")).toBeInTheDocument();
    expect(screen.getByText("Fakturerat (brutto)")).toBeInTheDocument();
    expect(screen.getByText("= Utestående fordran")).toBeInTheDocument();
    expect(screen.getByText("Netto realiserat")).toBeInTheDocument();
    expect(screen.getByText("0–30 dagar")).toBeInTheDocument();
    expect(screen.getByText(">90 dagar")).toBeInTheDocument();
    // per-faktura-tabellen (sammanslagen från "Fakturerat"-panelen)
    expect(screen.getByText("Per faktura")).toBeInTheDocument();
    // ärendet är klickbart → /matters, fakturadatumet → /invoices
    const matterLink = screen.getByRole("link", { name: /2026-0001 — Tvist/ });
    expect(matterLink.getAttribute("href")).toContain("matters");
    const invoiceLink = screen.getByRole("link", { name: /2026-03-10/ });
    expect(invoiceLink.getAttribute("href")).toContain("invoices");
  });

  it("visar 'inga förfallna' när alla hinkar är 0", () => {
    arQuery.data = {
      bridge: {
        fakturerat: 0, krediterat: 0, justerat: 0, inbetalt: 0, konstateradKundforlust: 0,
        utestaende: 0, ejForfallet: 0, forfallet: 0, nettoRealiserat: 0,
      },
      aging: [
        { label: "0–30 dagar", amount: 0 }, { label: "31–60 dagar", amount: 0 },
        { label: "61–90 dagar", amount: 0 }, { label: ">90 dagar", amount: 0 },
      ],
      rows: [],
    };
    render(<ArSummarySection from="2026-01-01" to="2026-06-30" />);
    expect(screen.getByText("Inga förfallna fakturor.")).toBeInTheDocument();
  });
});
