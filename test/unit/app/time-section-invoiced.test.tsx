/**
 * TimeSection — efter borttagning av Fakturerad/Faktura-kolumner och
 * "Låst på faktura"-state. Rättshjälp/rättsskydd-flödet bryter 1:1-
 * kopplingen mellan tidsrad och faktura, så koppling visas inte längre.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { TimeSection } from "@/app/matters/[id]/_time-section";
import { asId } from "@/lib/shared/schemas/ids";

const createMut = vi.fn();
const updateMut = vi.fn();
const deleteMut = vi.fn();

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
        create: { useMutation: () => ({ mutate: createMut, mutateAsync: vi.fn(), isPending: false }) },
        update: { useMutation: () => ({ mutate: updateMut, mutateAsync: vi.fn(), isPending: false }) },
        delete: { useMutation: () => ({ mutate: deleteMut, mutateAsync: vi.fn(), isPending: false }) },
      },
    },
  };
});

beforeEach(() => { vi.clearAllMocks(); });

function renderSection() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <TimeSection matterId={asId<"MatterId">("m-1")} />
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

describe("TimeSection — registrera/ändra/ta-bort-flöden", () => {
  it("'+ Registrera tid' → fyll formulär → Spara → create.mutate med matterId", () => {
    renderSection();
    fireEvent.click(screen.getByText("+ Registrera tid"));
    expect(screen.getByText("Registrera tid")).toBeInTheDocument();
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-05-20" } });
    fireEvent.change(document.querySelector('input[inputmode="numeric"]') as HTMLInputElement, { target: { value: "45" } });
    fireEvent.change(screen.getByPlaceholderText("Beskrivning *"), { target: { value: "Telefonsamtal" } });
    fireEvent.click(screen.getByText("Spara"));
    expect(createMut).toHaveBeenCalledWith(
      expect.objectContaining({ matterId: "m-1", minutes: 45, description: "Telefonsamtal" }),
    );
  });

  it("'Ändra' öppnar förifyllt edit-formulär → Spara → update.mutate med id", () => {
    renderSection();
    fireEvent.click(screen.getAllByText("Ändra")[0]!);
    expect(screen.getByText("Ändra tidregistrering")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Möte")).toBeInTheDocument(); // förifyllt ur te-1
    fireEvent.click(screen.getByText("Spara"));
    expect(updateMut).toHaveBeenCalledWith(expect.objectContaining({ id: "te-1" }));
  });

  it("'Ta bort' med confirm → delete.mutate med id", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderSection();
    fireEvent.click(screen.getAllByText("Ta bort")[0]!);
    expect(deleteMut).toHaveBeenCalledWith({ id: "te-1" });
    confirmSpy.mockRestore();
  });

  it("'Ta bort' med avbruten confirm → ingen delete", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderSection();
    fireEvent.click(screen.getAllByText("Ta bort")[0]!);
    expect(deleteMut).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("toggla Debiterbar i skapa-formuläret + Avbryt stänger modalen", () => {
    renderSection();
    fireEvent.click(screen.getByText("+ Registrera tid"));
    fireEvent.click(screen.getByRole("checkbox")); // Debiterbar
    fireEvent.click(screen.getByText("Avbryt"));
    expect(screen.queryByText("Registrera tid")).not.toBeInTheDocument();
  });
});
