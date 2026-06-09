/**
 * Test för ReportsPage.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { render, screen, fireEvent } from "@testing-library/react";
import ReportsPage from "@/app/reports/page";

const usersQuery = {
  data: undefined as Record<string, unknown> | undefined,
};
const reportQuery = {
  data: undefined as Record<string, unknown> | undefined,
  isLoading: false,
};
const billedQuery = {
  data: undefined as Record<string, unknown> | undefined,
  isLoading: false,
};

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ prefs: { get: { invalidate: vi.fn() } } }),
    user: {
      list: { useQuery: () => usersQuery },
      current: { useQuery: () => ({ data: { id: "u1", role: "LAWYER" } }) },
    },
    reports: {
      perLawyer: { useQuery: () => reportQuery },
      billed: { useQuery: () => billedQuery },
      arSummary: { useQuery: () => ({ data: undefined, isLoading: false }) },
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

beforeEach(() => {
  vi.clearAllMocks();
  usersQuery.data = { users: [{ id: "u1", name: "Anna" }, { id: "u2", name: "Bo" }] };
  reportQuery.data = undefined;
  reportQuery.isLoading = false;
  billedQuery.data = undefined;
  billedQuery.isLoading = false;
});

const sampleBilled = {
  user: { id: "u1", name: "Anna" },
  period: { from: "2026-06-01", to: "2026-06-30" },
  prevPeriod: { from: "2026-05-01", to: "2026-05-31" },
  invoices: [
    { id: "i1", invoiceDate: "2026-06-15T00:00:00.000Z", amountOre: 100000, shareOre: 75000, matterNumber: "2026-0001", title: "Tvist" },
  ],
  billedOre: 75000,
  writeOffOre: 10000,
  netOre: 65000,
};

const sampleReport = {
  user: { id: "u1", name: "Anna" },
  totals: {
    totalMinutes: 600,
    billableMinutes: 480,
    workValueOre: 1200000,
    expenseOre: 50000,
  },
  matters: [
    {
      matterId: "m1",
      matterNumber: "2026-0001",
      title: "Bodelning",
      client: "Klient A",
      paymentMethod: "RATTSHJALP",
      totalMinutes: 300,
      billableMinutes: 240,
      workValueOre: 600000,
      expenseOre: 25000,
    },
  ],
  weeklyRows: [
    {
      isoYear: 2026,
      week: 1,
      start: "2026-01-01",
      end: "2026-01-07",
      totalMinutes: 600,
      billableMinutes: 480,
      workValueOre: 1200000,
    },
  ],
  unbilled: {
    rows: [
      {
        matterId: "m2",
        matterNumber: "2026-0002",
        title: "Tvist",
        client: "Klient B",
        paymentMethod: "PRIVAT",
        timeOre: 800000,
        expenseOre: 0,
        total: 800000,
      },
    ],
    total: 800000,
  },
};

describe("ReportsPage", () => {
  it("renderar rubrik och period-formulär", () => {
    render(<ReportsPage />);
    expect(screen.getByRole("heading", { name: /Rapporter/i })).toBeInTheDocument();
    expect(screen.getByText(/Från/i)).toBeInTheDocument();
    expect(screen.getByText(/Till/i)).toBeInTheDocument();
    expect(screen.getByText(/Advokat/i)).toBeInTheDocument();
  });

  it("visar Laddar... i select när users inte är laddade", () => {
    usersQuery.data = undefined;
    render(<ReportsPage />);
    expect(screen.getByText(/Laddar\.\.\./i)).toBeInTheDocument();
  });

  it("listar advokater i select", () => {
    render(<ReportsPage />);
    const options = screen.getAllByRole("option") as HTMLOptionElement[];
    const names = options.map((o) => o.textContent);
    expect(names).toContain("Anna");
    expect(names).toContain("Bo");
  });

  it("visar Laddar rapport... när report.isLoading", () => {
    reportQuery.isLoading = true;
    render(<ReportsPage />);
    expect(screen.getByText(/Laddar rapport/i)).toBeInTheDocument();
  });

  it("renderar SummaryCard, MattersTable, WeeklyTable och UnbilledTable när data finns", () => {
    reportQuery.data = sampleReport;
    render(<ReportsPage />);
    expect(screen.getByText(/Ärenden under perioden/)).toBeInTheDocument();
    expect(screen.getByText(/Timdebitering per vecka/)).toBeInTheDocument();
    expect(screen.getByText(/Upparbetat, icke fakturerat/)).toBeInTheDocument();
    expect(screen.getByText(/2026-0001 — Bodelning/)).toBeInTheDocument();
    expect(screen.getByText(/2026-0002 — Tvist/)).toBeInTheDocument();
  });

  it("visar tomtmeddelande när matters är tom lista", () => {
    reportQuery.data = {
      ...sampleReport,
      matters: [],
      weeklyRows: [
        { ...sampleReport.weeklyRows[0], totalMinutes: 0, billableMinutes: 0, workValueOre: 0 },
      ],
      unbilled: { rows: [], total: 0 },
    };
    render(<ReportsPage />);
    expect(screen.getByText(/Inga ärenden i vald period/i)).toBeInTheDocument();
    expect(screen.getByText(/Ingen tid registrerad i vald period/i)).toBeInTheDocument();
    expect(screen.getByText(/Inget ofakturerat i vald period/i)).toBeInTheDocument();
  });

  it("byter period via from/to-input", () => {
    const { container } = render(<ReportsPage />);
    const inputs = container.querySelectorAll('input[type="date"]');
    fireEvent.change(inputs[0]!, { target: { value: "2026-03-01" } });
    fireEvent.change(inputs[1]!, { target: { value: "2026-04-01" } });
    expect((inputs[0] as HTMLInputElement).value).toBe("2026-03-01");
    expect((inputs[1] as HTMLInputElement).value).toBe("2026-04-01");
  });

  it("byter advokat via select", () => {
    render(<ReportsPage />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "u2" } });
    expect(select.value).toBe("u2");
  });

  it("Exportera Excel-knapp är inaktiv tills rapport finns", () => {
    render(<ReportsPage />);
    const btn = screen.getByRole("button", { name: /Exportera Excel/i });
    expect(btn).toBeDisabled();
  });

  it("Exportera Excel-knapp aktiveras när data finns och kan klickas", async () => {
    reportQuery.data = sampleReport;
    const fetchMock = vi.fn().mockResolvedValue({
      blob: () => Promise.resolve(new Blob(["x"])),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const createObjectURL = vi.fn().mockReturnValue("blob:url");
    const revokeObjectURL = vi.fn();
    global.URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    global.URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;

    render(<ReportsPage />);
    const btn = screen.getByRole("button", { name: /Exportera Excel/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    // Vänta på att fetch anropas
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalled();
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain("/api/reports/excel?");
    expect(url).toContain("userIds=u1");
  });

  it("renderar Fakturerat-rapporten med netto + fakturarad (#90)", () => {
    billedQuery.data = sampleBilled;
    render(<ReportsPage />);
    expect(screen.getByText(/Fakturerat — Anna/)).toBeInTheDocument();
    expect(screen.getByText("Netto-fakturerat")).toBeInTheDocument();
    // Fakturaraden syns (ärendenummer).
    expect(screen.getByText(/2026-0001/)).toBeInTheDocument();
  });

  it("visar inte Fakturerat-rapporten innan data finns", () => {
    render(<ReportsPage />);
    expect(screen.queryByText(/Fakturerat —/)).toBeNull();
  });
});
