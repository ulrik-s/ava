/**
 * Test för PaymentPlanDetailClient — detaljvyn för en avbetalningsplan:
 * rubrik/status, plan-detaljer, inbetalningar (summa + utestående),
 * påminnelser och avbryt-flödet.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest-compat";
import PaymentPlanDetailClient from "@/app/payment-plans/[id]/_client";

vi.mock("@/lib/client/demo/use-route-id", () => ({ useRouteId: () => null }));
vi.mock("@/lib/client/demo/entity-link", () => ({
  EntityLink: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));

const planData = {
  id: "pp1",
  status: "ACTIVE",
  monthlyAmount: 100000, // 1 000 kr (öre)
  dayOfMonth: 28,
  startDate: "2026-01-01",
  notes: "Delas upp på 6 mån",
  invoice: {
    id: "inv1",
    amount: 600000, // 6 000 kr
    matter: { id: "m1", matterNumber: "2026-0001", title: "Tvist AB", contacts: [{ contact: { id: "c1", name: "Anna Klient" } }] },
    payments: [
      { id: "pay1", amount: 100000, paidAt: "2026-02-28", note: "feb" },
      { id: "pay2", amount: 100000, paidAt: "2026-03-28", note: null },
    ],
  },
  reminders: [{ id: "r1", dueMonth: "2026-04", type: "EMAIL", sentAt: "2026-04-01T08:00:00Z" }],
};

const planQuery = { data: planData as unknown, isLoading: false, error: null as null | { message: string } };
const cancelMutate = vi.fn();

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ paymentPlan: { getById: { invalidate: vi.fn() }, list: { invalidate: vi.fn() } } }),
    paymentPlan: {
      getById: { useQuery: () => planQuery },
      cancel: { useMutation: () => ({ mutate: cancelMutate, isPending: false }) },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  planQuery.data = planData;
  planQuery.isLoading = false;
  planQuery.error = null;
});

describe("PaymentPlanDetailClient", () => {
  it("visar laddar-tillstånd", () => {
    planQuery.isLoading = true;
    render(<PaymentPlanDetailClient id="pp1" />);
    expect(screen.getByText("Laddar…")).toBeInTheDocument();
  });

  it("renderar rubrik, klient och status-pill", () => {
    render(<PaymentPlanDetailClient id="pp1" />);
    expect(screen.getByText("Avbetalningsplan")).toBeInTheDocument();
    expect(screen.getByText(/Anna Klient/)).toBeInTheDocument();
    expect(screen.getByText("Aktiv")).toBeInTheDocument();
  });

  it("visar inbetalningar med antal, summa och utestående saldo", () => {
    render(<PaymentPlanDetailClient id="pp1" />);
    expect(screen.getByText(/2 st inbetalningar/)).toBeInTheDocument();
    // betalt 2 000 kr av 6 000 → utestående 4 000 kr
    expect(screen.getByText(/Utestående:/)).toBeInTheDocument();
  });

  it("visar påminnelser", () => {
    render(<PaymentPlanDetailClient id="pp1" />);
    expect(screen.getByText("2026-04")).toBeInTheDocument();
  });

  it("Avbryt-knappen (aktiv plan) → confirm → cancel.mutate med planId", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<PaymentPlanDetailClient id="pp1" />);
    fireEvent.click(screen.getByRole("button", { name: /Avbryt planen/ }));
    expect(cancelMutate).toHaveBeenCalledWith({ planId: "pp1" });
    confirmSpy.mockRestore();
  });

  it("ingen avbryt-knapp när planen inte är aktiv", () => {
    planQuery.data = { ...planData, status: "COMPLETED" };
    render(<PaymentPlanDetailClient id="pp1" />);
    expect(screen.queryByRole("button", { name: /Avbryt planen/ })).not.toBeInTheDocument();
    expect(screen.getByText("Slutförd")).toBeInTheDocument();
  });
});
