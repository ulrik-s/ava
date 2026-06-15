/**
 * Test för ExpenseSection — utläggslistan i ett ärende: rendering av rader +
 * moms-uppdelning, summa-footer, lås av fakturerade utlägg, ta-bort-flödet
 * och "Nytt utlägg"-modalen.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest-compat";
import { ExpenseSection } from "@/app/matters/[id]/_expense-section";

vi.mock("@/lib/client/demo/entity-link", () => ({
  EntityLink: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));

const expenseQuery = {
  data: {
    expenses: [
      { id: "e1", date: "2026-03-01", amount: 12500, description: "Tågbiljett", billable: true, user: { name: "Anna" }, vatRate: 2500, vatIncluded: true, invoiceId: null },
      { id: "e2", date: "2026-03-02", amount: 50000, description: "Domstolsavgift", billable: true, user: { name: "Anna" }, vatRate: 2500, vatIncluded: true, invoiceId: "inv9", invoice: { id: "inv9", invoiceNumber: "F-2026-0001" } },
    ],
    totalAmount: 62500,
  } as unknown,
  isLoading: false,
};
const createMutate = vi.fn();
const updateMutate = vi.fn();
const deleteMutate = vi.fn();
const noopMut = () => ({ mutate: vi.fn(), isPending: false });

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ expense: { list: { invalidate: vi.fn() } } }),
    expense: {
      list: { useQuery: () => expenseQuery },
      create: { useMutation: () => ({ mutate: createMutate, isPending: false }) },
      update: { useMutation: () => ({ mutate: updateMutate, isPending: false }) },
      delete: { useMutation: () => ({ mutate: deleteMutate, isPending: false }) },
    },
    prefs: {
      get: { useQuery: () => ({ data: undefined, isLoading: false }) },
      save: { useMutation: noopMut },
      clear: { useMutation: noopMut },
      setOrgDefault: { useMutation: noopMut },
      clearOrgDefault: { useMutation: noopMut },
    },
    user: { current: { useQuery: () => ({ data: { id: "u1", role: "LAWYER" } }) } },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ExpenseSection", () => {
  it("renderar rubrik med total och utläggsraderna", () => {
    render(<ExpenseSection matterId="m1" />);
    expect(screen.getByText("Utlägg")).toBeInTheDocument();
    expect(screen.getByText(/totalt/)).toBeInTheDocument();
    expect(screen.getByText("Tågbiljett")).toBeInTheDocument();
    expect(screen.getByText("Domstolsavgift")).toBeInTheDocument();
  });

  it("visar summa-footer", () => {
    render(<ExpenseSection matterId="m1" />);
    expect(screen.getByText("Summa")).toBeInTheDocument();
  });

  it("låser fakturerade utlägg (ingen ändra/ta-bort) men tillåter åtgärder på ej fakturerade", () => {
    render(<ExpenseSection matterId="m1" />);
    expect(screen.getByText("Låst (på faktura)")).toBeInTheDocument();
    // Endast det ofakturerade utlägget (e1) har Ändra/Ta bort.
    expect(screen.getByText("Ändra")).toBeInTheDocument();
    expect(screen.getByText("Ta bort")).toBeInTheDocument();
  });

  it("Ta bort med confirm → delete.mutate med utläggets id", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ExpenseSection matterId="m1" />);
    fireEvent.click(screen.getByText("Ta bort"));
    expect(deleteMutate).toHaveBeenCalledWith({ id: "e1" });
    confirmSpy.mockRestore();
  });

  it("'+ Nytt utlägg' öppnar skapa-modalen", () => {
    render(<ExpenseSection matterId="m1" />);
    fireEvent.click(screen.getByText("+ Nytt utlägg"));
    expect(screen.getByText("Nytt utlägg")).toBeInTheDocument();
    expect(screen.getByText("Debiterbar")).toBeInTheDocument();
  });
});
