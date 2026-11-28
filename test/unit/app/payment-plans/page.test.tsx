/**
 * Test för PaymentPlansPage — utestående-kolumnen (ADR 0007): total − inbetalt
 * − avskrivet via ledgern.
 */

import { screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest-compat";

import PaymentPlansPage, { formatScanResult } from "@/app/payment-plans/page";
import { rowOrder, sortColumn } from "../../../helpers/data-table";
import { NEW_TRPC_BINDING, renderWithNewTrpc } from "../../../helpers/trpc-classic-mock";

// Kuvertform sedan #1014. `setRows` håller mockens form på ETT ställe, så
// testerna fortsätter tilldela rader utan att upprepa kuvertet.
const listQuery = { data: undefined as { items: unknown[]; total: number } | undefined, isLoading: false };
const setRows = (rows: unknown[] | undefined): void => {
  listQuery.data = rows === undefined ? undefined : { items: rows, total: rows.length };
};
type ScanResult = { scanned: number; planned: number; due: number; overdue: number };
const scanMutate = vi.fn();
const scanState = { isPending: false, error: null as null | { message: string } };
let scanOnSuccess: ((r: ScanResult) => void) | undefined;
const utilsMock = { prefs: { get: { invalidate: vi.fn() } }, paymentPlan: { list: { invalidate: vi.fn() } } };

vi.mock("@/lib/client/trpc", () => ({
  ...NEW_TRPC_BINDING,
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
const pushSpy = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushSpy }) }));

beforeEach(() => {
  vi.clearAllMocks();
  setRows(undefined);
  listQuery.isLoading = false;
  scanState.isPending = false;
  scanState.error = null;
  scanOnSuccess = undefined;
});

describe("PaymentPlansPage — utestående", () => {
  it("visar utestående = total − inbetalt − avskrivet", () => {
    setRows([
      {
        id: "pp1", status: "ACTIVE", monthlyAmount: 10_000, dayOfMonth: 15, startDate: new Date(),
        invoice: {
          amount: 100_000,
          payments: [{ amount: 30_000 }],
          writeOffs: [{ amount: 20_000 }],
          matter: { matterNumber: "2026-0001", title: "Tvist", contacts: [{ contact: { id: "c1", name: "Anna" } }] },
        },
      },
    ]);
    renderWithNewTrpc(<PaymentPlansPage />);
    // Radens status i singular (#1309) — "Aktiva" är filterknappen.
    expect(screen.getByText("Aktiv")).toBeInTheDocument();
    // 100 000 − 30 000 betalt − 20 000 avskrivet = 50 000 öre = 500 kr utestående
    expect(screen.getByText("Utestående")).toBeInTheDocument();
    // formatKr(50000) → "500,00 kr" (sv-SE). Matcha siffran robust.
    expect(screen.getByText(/500,00/)).toBeInTheDocument();
  });
});

describe("formatScanResult (#71)", () => {
  it("noll planerade → 'inga nya'", () => {
    expect(formatScanResult({ scanned: 5, planned: 0, due: 0, overdue: 0 })).toBe("Inga nya påminnelser (skannade 5 aktiva planer).");
  });
  it("planerade → antal registrerade + förfaller/försenade (#2135)", () => {
    expect(formatScanResult({ scanned: 4, planned: 3, due: 2, overdue: 1 }))
      .toBe("3 påminnelser registrerade — 2 förfaller, 1 försenade (av 4 planer).");
  });
});

describe("PaymentPlansPage — Registrera påminnelser (#71, #2135)", () => {
  it("knappen kör scanDueReminders med {}", () => {
    renderWithNewTrpc(<PaymentPlansPage />);
    fireEvent.click(screen.getByTestId("send-reminders"));
    expect(scanMutate).toHaveBeenCalledWith({});
  });

  it("visar resultat + invaliderar listan vid onSuccess", () => {
    renderWithNewTrpc(<PaymentPlansPage />);
    fireEvent.click(screen.getByTestId("send-reminders"));
    act(() => scanOnSuccess?.({ scanned: 3, planned: 2, due: 1, overdue: 1 }));
    expect(screen.getByTestId("scan-result").textContent).toContain("2 påminnelser registrerade");
    expect(utilsMock.paymentPlan.list.invalidate).toHaveBeenCalled();
  });

  it("knappen heter Registrera påminnelser, och sidan säger inte att något skickas", () => {
    renderWithNewTrpc(<PaymentPlansPage />);
    expect(screen.getByTestId("send-reminders").textContent).toBe("Registrera påminnelser");
    expect(document.body.textContent).not.toMatch(/skicka/i);
  });

  it("disablad + 'Registrerar…' medan mutationen körs", () => {
    scanState.isPending = true;
    renderWithNewTrpc(<PaymentPlansPage />);
    const btn = screen.getByTestId<HTMLButtonElement>("send-reminders");
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe("Registrerar…");
  });

  it("fel → Kunde inte registrera: <fel>", () => {
    scanState.error = { message: "nätverket" };
    renderWithNewTrpc(<PaymentPlansPage />);
    expect(screen.getByText("Kunde inte registrera: nätverket")).toBeInTheDocument();
  });
});

describe("PaymentPlansPage — filter, sök, rad-klick", () => {
  const planRow = {
    id: "pp1", status: "ACTIVE", monthlyAmount: 10_000, dayOfMonth: 15, startDate: new Date(),
    invoice: {
      amount: 100_000, payments: [], writeOffs: [],
      matter: { matterNumber: "2026-0001", title: "Tvist", contacts: [{ contact: { id: "c1", name: "Anna" } }] },
    },
  };

  it("status-filter: klick på Slutförda/Avbrutna sätter aria-pressed", () => {
    renderWithNewTrpc(<PaymentPlansPage />);
    const completed = screen.getByRole("button", { name: "Slutförda" });
    fireEvent.click(completed);
    expect(completed).toHaveAttribute("aria-pressed", "true");
    const cancelled = screen.getByRole("button", { name: "Avbrutna" });
    fireEvent.click(cancelled);
    expect(cancelled).toHaveAttribute("aria-pressed", "true");
    expect(completed).toHaveAttribute("aria-pressed", "false");
  });

  it("status-filtret är en knappgrupp med namnet Status (#1805)", () => {
    renderWithNewTrpc(<PaymentPlansPage />);
    const group = screen.getByRole("group", { name: "Status" });
    expect(group).toHaveTextContent("AktivaSlutfördaAvbrutna");
    expect(screen.getByRole("button", { name: "Aktiva" })).toHaveAttribute("aria-pressed", "true");
  });

  it("sökfältet uppdaterar värdet", () => {
    renderWithNewTrpc(<PaymentPlansPage />);
    const search = screen.getByPlaceholderText<HTMLInputElement>(/Sök på klient/);
    fireEvent.change(search, { target: { value: "Anna" } });
    expect(search.value).toBe("Anna");
  });

  it("rad-klick navigerar till plan-detaljen (router.push)", () => {
    setRows([planRow]);
    renderWithNewTrpc(<PaymentPlansPage />);
    fireEvent.click(screen.getByText("Tvist"));
    expect(pushSpy).toHaveBeenCalled();
  });

  it("laddar-tillstånd visar 'Laddar…'", () => {
    listQuery.isLoading = true;
    renderWithNewTrpc(<PaymentPlansPage />);
    expect(screen.getByText("Laddar…")).toBeInTheDocument();
  });
});

describe("PaymentPlansPage — Förfallen N dagar (#2136)", () => {
  const behind = (paid: number[]) => ({
    id: "pp1", status: "ACTIVE", monthlyAmount: 10_000, dayOfMonth: 25, startDate: "2026-11-01T09:00:00.000Z",
    invoice: {
      amount: 100_000, payments: paid.map((amount) => ({ amount })), writeOffs: [],
      matter: { matterNumber: "2026-0001", title: "Tvist", contacts: [] },
    },
  });

  beforeEach(() => vi.setSystemTime(new Date("2026-11-28T10:00:00Z")));
  afterEach(() => vi.setSystemTime());

  it("en plan som ligger efter visar Förfallen 3 dagar efter statusmärket", () => {
    setRows([behind([])]);
    renderWithNewTrpc(<PaymentPlansPage />);
    expect(screen.getByText("Förfallen 3 dagar")).toBeInTheDocument();
    expect(screen.getByText("Aktiv")).toBeInTheDocument();
  });

  it("en plan som är ikapp visar ingen markering", () => {
    setRows([behind([10_000])]);
    renderWithNewTrpc(<PaymentPlansPage />);
    expect(screen.queryByText(/^Förfallen/)).toBeNull();
  });
});

describe("PaymentPlansPage — sortering per kolumn (#1907)", () => {
  const plan = (id: string, status: string, monthlyAmount: number, invoice?: Record<string, unknown>) => ({
    id, status, monthlyAmount, dayOfMonth: 1, startDate: "2099-01-01", ...(invoice ? { invoice } : {}),
  });
  const rows = () => [
    plan("p1", "ACTIVE", 5_000, {
      amount: 100_000, payments: [{ amount: 75_000 }], writeOffs: [],
      matter: { matterNumber: "2026-0002", title: "Beta", contacts: [{ contact: { id: "c1", name: "Örjan" } }] },
    }),
    plan("p2", "CANCELLED", 20_000, {
      amount: 400_000, payments: [{ amount: 100_000 }], writeOffs: [{ amount: 200_000 }],
      matter: { matterNumber: "2026-0001", title: "Alfa", contacts: [{ contact: { id: "c2", name: "Anna" } }] },
    }),
    // Utan faktura: tomma fält sorteras först och visas som "—", andelen 0 %.
    plan("p3", "COMPLETED", 10_000),
  ];
  const order = (): string[] => rowOrder(["Beta", "Alfa", "Slutförd"]);

  it("varje kolumn sorterar på det som visas", () => {
    setRows(rows());
    renderWithNewTrpc(<PaymentPlansPage />);
    sortColumn("Ärendenr", "asc");
    expect(order()).toEqual(["Slutförd", "Alfa", "Beta"]);
    sortColumn("Titel", "desc");
    expect(order()).toEqual(["Beta", "Alfa", "Slutförd"]);
    sortColumn("Klient", "asc");
    expect(order()).toEqual(["Slutförd", "Alfa", "Beta"]);
    sortColumn("Status", "asc");
    expect(order()).toEqual(["Beta", "Alfa", "Slutförd"]);
    sortColumn("Per månad", "desc");
    expect(order()).toEqual(["Alfa", "Slutförd", "Beta"]);
    sortColumn("Inbetalt", "asc");
    expect(order()).toEqual(["Slutförd", "Beta", "Alfa"]);
    sortColumn("Totalt", "desc");
    expect(order()).toEqual(["Alfa", "Beta", "Slutförd"]);
    sortColumn("Utestående", "desc");
    expect(order()).toEqual(["Alfa", "Beta", "Slutförd"]);
    sortColumn("Andel", "desc");
    expect(order()).toEqual(["Beta", "Alfa", "Slutförd"]);
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(3);
  });
});
