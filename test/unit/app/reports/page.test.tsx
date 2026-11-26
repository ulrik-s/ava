/**
 * Test för ReportsPage.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import ReportsPage from "@/app/reports/page";

const usersQuery = {
  data: undefined as Record<string, unknown> | undefined,
};
const reportQuery = {
  data: undefined as Record<string, unknown> | null | undefined,
  isLoading: false,
  error: null as { message: string } | null,
};
const chartCalls: Array<{ userId: string; from: string; to: string; granularity: string }> = [];
const billedQuery = {
  data: undefined as Record<string, unknown> | undefined,
  isLoading: false,
};

// Dockytan (#1184) kräver en riktig webbläsarlayout — här renderas huvudet och
// alla paneler efter varandra, synkront, så testerna kan granska innehållet.
vi.mock("@/components/layout/panel-page", () => ({
  PanelPage: ({ header, panels }: { header: React.ReactNode; panels: ReadonlyArray<{ id: string; render: () => React.ReactNode }> }) => (
    <>{header}{panels.map((p) => <div key={p.id} data-panel={p.id}>{p.render()}</div>)}</>
  ),
}));

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ prefs: { get: { invalidate: vi.fn() } } }),
    user: {
      list: { useQuery: () => usersQuery },
      current: { useQuery: () => ({ data: { id: "u1", role: "LAWYER" } }) },
    },
    timeEntry: {
      chart: {
        useQuery: (input: (typeof chartCalls)[number]) => {
          chartCalls.push(input);
          return { data: { totalMinutes: 0, billableMinutes: 0, bars: [] } };
        },
      },
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
  chartCalls.length = 0;
  usersQuery.data = { users: [{ id: "u1", name: "Anna" }, { id: "u2", name: "Bo" }] };
  reportQuery.data = undefined;
  reportQuery.isLoading = false;
  reportQuery.error = null;
  billedQuery.data = undefined;
  billedQuery.isLoading = false;
});

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
    const options = screen.getAllByRole<HTMLOptionElement>("option");
    const names = options.map((o) => o.textContent);
    expect(names).toContain("Anna");
    expect(names).toContain("Bo");
  });

  it("visar Laddar rapport... när report.isLoading", () => {
    reportQuery.isLoading = true;
    render(<ReportsPage />);
    expect(screen.getAllByText(/Laddar rapport/i).length).toBeGreaterThan(0); // en per rapportpanel (#1184)
  });

  it("rapporten felar → panelerna visar felet, inte \"Välj jurist och period.\" (#1303)", () => {
    reportQuery.error = { message: "w.getUTCFullYear is not a function" };
    render(<ReportsPage />);
    expect(screen.getAllByText(/Rapporten kunde inte hämtas: w.getUTCFullYear is not a function/).length).toBe(4);
    expect(screen.queryByText("Välj jurist och period.")).toBeNull();
  });

  it("advokaten finns inte (null) → säger det (#1303)", () => {
    reportQuery.data = null;
    render(<ReportsPage />);
    expect(screen.getAllByText("Advokaten hittades inte.").length).toBe(4);
    expect(screen.queryByText("Välj jurist och period.")).toBeNull();
  });

  it("ingen advokat att välja → \"Välj jurist och period.\"", () => {
    usersQuery.data = { users: [] };
    render(<ReportsPage />);
    // Stapeldiagrammet (#2110) visar samma text utan vald advokat.
    expect(screen.getAllByText("Välj jurist och period.").length).toBe(5);
    expect(chartCalls).toHaveLength(0);
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

  it("tid visas i decimaltimmar med enhet i rubrikerna (#1542)", () => {
    reportQuery.data = sampleReport;
    render(<ReportsPage />);
    expect(screen.getByText("10 h")).toBeInTheDocument(); // totalt 600 min
    expect(screen.getByText("8 h")).toBeInTheDocument(); // debiterbart 480 min
    expect(screen.getAllByRole("columnheader", { name: /^Tid \(h\)/ }).length).toBe(2);
    expect(screen.getAllByRole("columnheader", { name: /^Deb\. tid \(h\)/ }).length).toBe(2);
    expect(screen.queryByText(/\b\d+:\d\d\b/)).toBeNull();
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
    const select = screen.getByRole<HTMLSelectElement>("combobox");
    fireEvent.change(select, { target: { value: "u2" } });
    expect(select.value).toBe("u2");
  });

  it("Exportera Excel-knapp är inaktiv tills rapport finns", () => {
    render(<ReportsPage />);
    const btn = screen.getByRole("button", { name: /Exportera Excel/i });
    expect(btn).toBeDisabled();
  });

  it("Exportera Excel laddar ner rapporten som CSV byggd i klienten, utan nätverksanrop (#1793)", async () => {
    reportQuery.data = sampleReport;
    const fetchMock = vi.fn();
    global.fetch = fetchMock; // fetch får aldrig anropas
    const blobs: Blob[] = [];
    global.URL.createObjectURL = vi.fn((b: Blob) => { blobs.push(b); return "blob:url"; });
    global.URL.revokeObjectURL = vi.fn();
    const downloads: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });

    const { container } = render(<ReportsPage />);
    const from = (container.querySelector('input[type="date"]') as HTMLInputElement).value;
    const btn = screen.getByRole("button", { name: /Exportera Excel/i });
    expect(btn).not.toBeDisabled();
    expect(btn.getAttribute("title")).toMatch(/CSV-fil som öppnas i Excel/);
    fireEvent.click(btn);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(downloads).toHaveLength(1);
    expect(downloads[0]).toMatch(new RegExp(`^tidsrapport_${from}_\\d{4}-\\d{2}-\\d{2}\\.csv$`));
    expect(blobs[0]?.type).toBe("text/csv;charset=utf-8");
    const csv = await blobs[0]!.text();
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
    expect(lines.indexOf("Ärenden under perioden")).toBe(0);
    expect(lines).toContain("Timdebitering per vecka");
    expect(lines).toContain("Upparbetat, icke fakturerat");
    expect(lines).toContain("2026-0001 — Bodelning;Klient A;Rättshjälp;5,00;4,00;6000,00;250,00");
    click.mockRestore();
  });

  it("rutan Stapeldiagram visar veckan som innehåller Till för vald advokat, och ett nytt Till flyttar den (#2110)", () => {
    const { container } = render(<ReportsPage />);
    expect(container.querySelector('[data-panel="chart"]')).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Till"), { target: { value: "2026-04-01" } });
    expect(chartCalls[chartCalls.length - 1]).toEqual({ userId: "u1", from: "2026-03-30", to: "2026-04-05", granularity: "day" });
    expect(screen.getByRole("heading", { name: /^Vecka 14 2026/ })).toBeInTheDocument();

    fireEvent.change(screen.getByRole<HTMLSelectElement>("combobox"), { target: { value: "u2" } });
    expect(chartCalls[chartCalls.length - 1]).toMatchObject({ userId: "u2", from: "2026-03-30" });
  });
});
