/**
 * TimeSection — efter borttagning av Fakturerad/Faktura-kolumner och
 * "Låst på faktura"-state. Rättshjälp/rättsskydd-flödet bryter 1:1-
 * kopplingen mellan tidsrad och faktura, så koppling visas inte längre.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TimeSection } from "@/app/matters/[id]/_time-section";

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

describe("TimeSection — utan invoice-koppling i UI", () => {
  it("renderar INGEN 'Fakturerad'-kolumn", () => {
    renderSection();
    expect(screen.queryByText("Fakturerad")).not.toBeInTheDocument();
  });

  it("renderar INGEN 'Faktura'-kolumn (även för entries med invoiceId)", () => {
    renderSection();
    expect(screen.queryByText("Faktura")).not.toBeInTheDocument();
    expect(screen.queryByText("2026-0042")).not.toBeInTheDocument();
  });

  it("alla entries får Ändra + Ta bort — ingen 'Låst (på faktura)'-state", () => {
    renderSection();
    expect(screen.queryByText(/Låst/)).not.toBeInTheDocument();
    expect(screen.getAllByText("Ändra")).toHaveLength(2);
    expect(screen.getAllByText("Ta bort")).toHaveLength(2);
  });
});
