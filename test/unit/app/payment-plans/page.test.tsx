/**
 * Test för PaymentPlansPage — utestående-kolumnen (ADR 0007): total − inbetalt
 * − avskrivet via ledgern.
 */

import { describe, it, expect, beforeEach, vi } from "vitest-compat";
import { render, screen, fireEvent, act } from "@testing-library/react";

const listQuery = { data: undefined as unknown[] | undefined, isLoading: false };
type ScanResult = { scanned: number; planned: number; due: number; overdue: number };
const scanMutate = vi.fn();
const scanState = { isPending: false, error: null as null | { message: string } };
let scanOnSuccess: ((r: ScanResult) => void) | undefined;
const utilsMock = { prefs: { get: { invalidate: vi.fn() } }, paymentPlan: { list: { invalidate: vi.fn() } } };

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => utilsMock,
    user: {
      current: { useQuery: () => ({ data: { id: "u1", role: "LAWYER" } }) },
      list: { useQuery: () => ({ data: { users: [] } }) },
    },
    paymentPlan: {
      list: { useQuery: () => listQuery },
      scanDueReminders: {
        useMutation: (opts?: { onSuccess?: (r: ScanResult) => void }) => {
          scanOnSuccess = opts?.onSuccess;
          return { mutate: (a: unknown) => scanMutate(a), isPending: scanState.isPending, error: scanState.error };
        },
      },
    },
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

import PaymentPlansPage, { formatScanResult } from "@/app/payment-plans/page";

beforeEach(() => {
  vi.clearAllMocks();
  listQuery.data = undefined;
  listQuery.isLoading = false;
  scanState.isPending = false;
  scanState.error = null;
  scanOnSuccess = undefined;
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

describe("formatScanResult (#71)", () => {
  it("noll planerade → 'inga nya'", () => {
    expect(formatScanResult({ scanned: 5, planned: 0, due: 0, overdue: 0 })).toMatch(/Inga nya/);
  });
  it("planerade → antal + förfaller/försenade", () => {
    const msg = formatScanResult({ scanned: 4, planned: 3, due: 2, overdue: 1 });
    expect(msg).toContain("3 påminnelser");
    expect(msg).toContain("2 förfaller");
    expect(msg).toContain("1 försenade");
  });
});

describe("PaymentPlansPage — Skicka påminnelser nu (#71)", () => {
  it("knappen kör scanDueReminders med {}", () => {
    render(<PaymentPlansPage />);
    fireEvent.click(screen.getByTestId("send-reminders"));
    expect(scanMutate).toHaveBeenCalledWith({});
  });

  it("visar resultat + invaliderar listan vid onSuccess", () => {
    render(<PaymentPlansPage />);
    fireEvent.click(screen.getByTestId("send-reminders"));
    act(() => scanOnSuccess?.({ scanned: 3, planned: 2, due: 1, overdue: 1 }));
    expect(screen.getByTestId("scan-result").textContent).toContain("2 påminnelser");
    expect(utilsMock.paymentPlan.list.invalidate).toHaveBeenCalled();
  });

  it("disablad + 'Skickar…' medan mutationen körs", () => {
    scanState.isPending = true;
    render(<PaymentPlansPage />);
    const btn = screen.getByTestId("send-reminders") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain("Skickar");
  });
});
