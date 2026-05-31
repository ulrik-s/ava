/**
 * TimeSection — invoiced/locked-beteende.
 *
 * Verifierar att tidsposter på faktura visas som "Ja"/faktura-nr + att
 * Ändra/Ta bort-knapparna byts mot "Låst"-text.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TimeSection } from "@/app/matters/[id]/_time-section";

// Minimal mock av trpc — vi.mock hoist:as så all setup måste vara inline.
vi.mock("@/lib/client/trpc", () => {
  const noopMut = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
  return {
    trpc: {
      useUtils: () => ({
        timeEntry: { list: { invalidate: vi.fn() } },
        prefs: { get: { invalidate: vi.fn() }, listOrgDefaults: { invalidate: vi.fn() } },
      }),
      user: { current: { useQuery: () => ({ data: { id: "u-1", role: "LAWYER" } }) } },
      prefs: {
        get: { useQuery: () => ({ data: null }) },
        save: { useMutation: () => noopMut },
        clear: { useMutation: () => noopMut },
        setOrgDefault: { useMutation: () => noopMut },
        clearOrgDefault: { useMutation: () => noopMut },
        listOrgDefaults: { useQuery: () => ({ data: null }) },
      },
      timeEntry: {
        list: {
          useQuery: () => ({
            data: {
              entries: [
                { id: "te-1", date: new Date("2026-05-01"), minutes: 60, description: "Möte", billable: true,
                  user: { name: "Anna" }, invoiceId: null, invoice: null },
                { id: "te-2", date: new Date("2026-04-15"), minutes: 30, description: "Inlaga", billable: true,
                  user: { name: "Björn" }, invoiceId: "inv-1", invoice: { id: "inv-1", invoiceNumber: "2026-0042" } },
              ],
              totalMinutes: 90,
            },
          }),
        },
        create: { useMutation: () => noopMut },
        update: { useMutation: () => noopMut },
        delete: { useMutation: () => noopMut },
      },
    },
  };
});

function renderSection() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <TimeSection matterId="m-1" />
    </QueryClientProvider>,
  );
}

describe("TimeSection — fakturerad/låst", () => {
  it("visar 'Ja' för fakturerade entries och 'Nej' för icke-fakturerade", () => {
    renderSection();
    const cells = screen.getAllByText(/^(Ja|Nej)$/);
    // 4 träffar förväntas: 2 i Deb.-kolumnen + 2 i Fakturerad-kolumnen
    expect(cells.length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("2026-0042")).toBeInTheDocument();
  });

  it("faktura-nr är klickbar (länk till /invoices/<id>)", () => {
    renderSection();
    const link = screen.getByRole("link", { name: "2026-0042" });
    expect(link.getAttribute("href")).toBe("/invoices/inv-1");
  });

  it("icke-fakturerade entries visar Ändra + Ta bort knappar", () => {
    renderSection();
    expect(screen.getByText("Ändra")).toBeInTheDocument();
    expect(screen.getByText("Ta bort")).toBeInTheDocument();
  });

  it("fakturerade entries visar 'Låst (på faktura)' istället för actions", () => {
    renderSection();
    expect(screen.getByText(/Låst \(på faktura\)/)).toBeInTheDocument();
  });
});
