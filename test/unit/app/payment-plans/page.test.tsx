/**
 * Test för PaymentPlansPage — utestående-kolumnen (ADR 0007): total − inbetalt
 * − avskrivet via ledgern.
 */

import { describe, it, expect, beforeEach, vi } from "vitest-compat";
import { render, screen } from "@testing-library/react";

const listQuery = { data: undefined as unknown[] | undefined, isLoading: false };

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ prefs: { get: { invalidate: vi.fn() } } }),
    user: {
      current: { useQuery: () => ({ data: { id: "u1", role: "LAWYER" } }) },
      list: { useQuery: () => ({ data: { users: [] } }) },
    },
    paymentPlan: { list: { useQuery: () => listQuery } },
    prefs: {
      get: { useQuery: () => ({ data: undefined, isLoading: false }) },
      save: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clear: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      setOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clearOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import PaymentPlansPage from "@/app/payment-plans/page";

beforeEach(() => {
  listQuery.data = undefined;
  listQuery.isLoading = false;
});

describe("PaymentPlansPage — utestående", () => {
  it("visar utestående = total − inbetalt − avskrivet", () => {
    listQuery.data = [
      {
        id: "pp1", status: "ACTIVE", monthlyAmount: 10_000, dayOfMonth: 15,
        invoice: {
          amount: 100_000,
          payments: [{ amount: 30_000 }],
          writeOffs: [{ amount: 20_000 }],
          matter: { matterNumber: "2026-0001", title: "Tvist", contacts: [{ contact: { id: "c1", name: "Anna" } }] },
        },
      },
    ];
    render(<PaymentPlansPage />);
    // 100 000 − 30 000 betalt − 20 000 avskrivet = 50 000 öre = 500 kr utestående
    expect(screen.getByText("Utestående")).toBeInTheDocument();
    // formatCurrency(50000) → "500,00 kr" (sv-SE). Matcha siffran robust.
    expect(screen.getByText(/500,00/)).toBeInTheDocument();
  });
});
