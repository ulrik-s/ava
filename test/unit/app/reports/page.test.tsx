/**
 * Test för ReportsPage. Fältet Advokat följer rollen (#2116): förvald är den
 * inloggade, en Advokat har bara sig själv, en Admin har Alla överst.
 */

import { screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import ReportsPage from "@/app/reports/page";
import { rowOrder, rowWith, sortColumn } from "../../../helpers/data-table";
import { NEW_TRPC_BINDING, renderWithNewTrpc, type NewTrpcRender } from "../../../helpers/trpc-classic-mock";
import { seedQuery } from "../../../helpers/trpc-seeded";

const usersQuery = {
  data: undefined as Record<string, unknown> | undefined,
};
const reportQuery = {
  data: undefined as Record<string, unknown> | null | undefined,
  isLoading: false,
  error: null as { message: string } | null,
};
const chartCalls: Array<{ userId?: string; from: string; to: string; granularity: string }> = [];
const currentUser = { data: undefined as { id: string; role: string } | undefined };
const reportCalls: Array<{ input: Record<string, unknown>; enabled: boolean }> = [];
const arCalls: Array<Record<string, unknown>> = [];
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
  ...NEW_TRPC_BINDING,
  trpc: {
    useUtils: () => ({ prefs: { get: { invalidate: vi.fn() } } }),
    user: {
      list: { useQuery: () => usersQuery },
      current: { useQuery: () => currentUser },
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
      perLawyer: {
        useQuery: (input: Record<string, unknown>, opts: { enabled: boolean }) => {
          reportCalls.push({ input, enabled: opts.enabled });
          return reportQuery;
        },
      },
      billed: { useQuery: () => billedQuery },
      arSummary: {
        useQuery: (input: Record<string, unknown>) => {
          arCalls.push(input);
          return { data: undefined, isLoading: false };
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

/** Renderar som den inloggade (`user.current`, som tittaren på rapporterna läser med den nya bindningen). */
function renderAsViewer(ui: React.ReactElement): NewTrpcRender {
  return renderWithNewTrpc(ui, {
    handlers: { "user.current": () => currentUser.data },
    seed: (t, qc) => { seedQuery(qc, t.user.current.queryKey(), currentUser.data); },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  chartCalls.length = 0;
  reportCalls.length = 0;
  arCalls.length = 0;
  currentUser.data = { id: "u1", role: "ADMIN" };
  usersQuery.data = { users: [{ id: "u1", name: "Anna" }, { id: "u2", name: "Bo" }] };
  reportQuery.data = undefined;
  reportQuery.isLoading = false;
  reportQuery.error = null;
  billedQuery.data = undefined;
  billedQuery.isLoading = false;
});

const sampleReport = {
  scope: "lawyer",
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
    renderAsViewer(<ReportsPage />);
    expect(screen.getByRole("heading", { name: /Rapporter/i })).toBeInTheDocument();
    expect(screen.getByText(/Från/i)).toBeInTheDocument();
    expect(screen.getByText(/Till/i)).toBeInTheDocument();
    expect(screen.getByText(/Advokat/i)).toBeInTheDocument();
  });

  it("visar Laddar... i select när users inte är laddade", () => {
    usersQuery.data = undefined;
    renderAsViewer(<ReportsPage />);
    expect(screen.getByText(/Laddar\.\.\./i)).toBeInTheDocument();
  });

  it("listar advokater i select", () => {
    renderAsViewer(<ReportsPage />);
    const options = screen.getAllByRole<HTMLOptionElement>("option");
    const names = options.map((o) => o.textContent);
    expect(names).toContain("Anna");
    expect(names).toContain("Bo");
  });

  it("visar Laddar rapport... när report.isLoading", () => {
    reportQuery.isLoading = true;
    renderAsViewer(<ReportsPage />);
    expect(screen.getAllByText(/Laddar rapport/i).length).toBeGreaterThan(0); // en per rapportpanel (#1184)
  });

  it("rapporten felar → panelerna visar felet, inte \"Välj jurist och period.\" (#1303)", () => {
    reportQuery.error = { message: "w.getUTCFullYear is not a function" };
    renderAsViewer(<ReportsPage />);
    expect(screen.getAllByText(/Rapporten kunde inte hämtas: w.getUTCFullYear is not a function/).length).toBe(4);
    expect(screen.queryByText("Välj jurist och period.")).toBeNull();
  });

  it("advokaten finns inte (null) → säger det (#1303)", () => {
    reportQuery.data = null;
    renderAsViewer(<ReportsPage />);
    expect(screen.getAllByText("Advokaten hittades inte.").length).toBe(4);
    expect(screen.queryByText("Välj jurist och period.")).toBeNull();
  });

  it("innan rollen är känd: Laddar... och ingen rapport, inga kundfordringar och inget diagram (#2116)", () => {
    currentUser.data = undefined;
    renderAsViewer(<ReportsPage />);
    expect(screen.getByRole("option", { name: "Laddar..." })).toBeInTheDocument();
    expect(reportCalls.every((c) => !c.enabled)).toBe(true);
    expect(arCalls).toHaveLength(0);
    expect(chartCalls).toHaveLength(0);
    // Rapportpanelerna, kundfordringarna och diagrammet väntar.
    expect(screen.getAllByText("Välj jurist och period.").length).toBe(6);
  });

  it("förvald är den inloggade, också när den inte står först i listan (#2116)", () => {
    currentUser.data = { id: "u2", role: "ADMIN" };
    renderAsViewer(<ReportsPage />);
    expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe("u2");
    expect(reportCalls[reportCalls.length - 1]).toMatchObject({ input: { userId: "u2" }, enabled: true });
  });

  it("en Advokat har bara sig själv i listan (#2116)", () => {
    currentUser.data = { id: "u2", role: "LAWYER" };
    renderAsViewer(<ReportsPage />);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Bo"]);
    expect(reportCalls[reportCalls.length - 1]?.input).toMatchObject({ userId: "u2" });
  });

  it("en Admin har Alla överst; med Alla gäller allt hela byrån (#2116)", () => {
    reportQuery.data = {
      ...sampleReport, scope: "firm", user: null,
    };
    renderAsViewer(<ReportsPage />);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Alla", "Anna", "Bo"]);
    fireEvent.change(screen.getByRole<HTMLSelectElement>("combobox"), { target: { value: "ALLA" } });

    expect(reportCalls[reportCalls.length - 1]?.input).not.toHaveProperty("userId");
    expect(arCalls[arCalls.length - 1]).not.toHaveProperty("userId");
    expect(chartCalls[chartCalls.length - 1]).not.toHaveProperty("userId");
    expect(screen.queryByText(/andel för/)).toBeNull();
    expect(screen.getByText("Alla", { selector: "div" })).toBeInTheDocument();
    expect(screen.getByText("Ärenden där någon på byrån har registrerat tid eller utlägg.")).toBeInTheDocument();
    expect(screen.getByText(/Debiterbar tid och utlägg för hela byrån inom perioden som/)).toBeInTheDocument();
  });

  it("för en vald advokat: namnet i texterna och kundfordringarna för advokaten", () => {
    reportQuery.data = sampleReport;
    renderAsViewer(<ReportsPage />);
    expect(screen.getByText("Ärenden där Anna har registrerat tid eller utlägg.")).toBeInTheDocument();
    expect(screen.getByText(/Debiterbar tid och utlägg för Anna inom perioden/)).toBeInTheDocument();
    expect(arCalls[arCalls.length - 1]).toMatchObject({ userId: "u1" });
  });

  it("renderar SummaryCard, MattersTable, WeeklyTable och UnbilledTable när data finns", () => {
    reportQuery.data = sampleReport;
    renderAsViewer(<ReportsPage />);
    expect(screen.getByText(/Ärenden under perioden/)).toBeInTheDocument();
    expect(screen.getByText(/Timdebitering per vecka/)).toBeInTheDocument();
    expect(screen.getByText(/Upparbetat, icke fakturerat/)).toBeInTheDocument();
    expect(screen.getByText(/2026-0001 — Bodelning/)).toBeInTheDocument();
    expect(screen.getByText(/2026-0002 — Tvist/)).toBeInTheDocument();
  });

  it("tid visas i decimaltimmar med enhet i rubrikerna (#1542)", () => {
    reportQuery.data = sampleReport;
    renderAsViewer(<ReportsPage />);
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
    renderAsViewer(<ReportsPage />);
    expect(screen.getByText(/Inga ärenden i vald period/i)).toBeInTheDocument();
    expect(screen.getByText(/Ingen tid registrerad i vald period/i)).toBeInTheDocument();
    expect(screen.getByText(/Inget ofakturerat i vald period/i)).toBeInTheDocument();
  });

  it("byter period via from/to-input", () => {
    const { container } = renderAsViewer(<ReportsPage />);
    const inputs = container.querySelectorAll('input[type="date"]');
    fireEvent.change(inputs[0]!, { target: { value: "2026-03-01" } });
    fireEvent.change(inputs[1]!, { target: { value: "2026-04-01" } });
    expect((inputs[0] as HTMLInputElement).value).toBe("2026-03-01");
    expect((inputs[1] as HTMLInputElement).value).toBe("2026-04-01");
  });

  it("byter advokat via select", () => {
    renderAsViewer(<ReportsPage />);
    const select = screen.getByRole<HTMLSelectElement>("combobox");
    fireEvent.change(select, { target: { value: "u2" } });
    expect(select.value).toBe("u2");
  });

  it("Exportera Excel-knapp är inaktiv tills rapport finns", () => {
    renderAsViewer(<ReportsPage />);
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

    const { container } = renderAsViewer(<ReportsPage />);
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
    const { container } = renderAsViewer(<ReportsPage />);
    expect(container.querySelector('[data-panel="chart"]')).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Till"), { target: { value: "2026-04-01" } });
    expect(chartCalls[chartCalls.length - 1]).toEqual({ userId: "u1", from: "2026-03-30", to: "2026-04-05", granularity: "day" });
    expect(screen.getByRole("heading", { name: /^Vecka 14 2026/ })).toBeInTheDocument();

    fireEvent.change(screen.getByRole<HTMLSelectElement>("combobox"), { target: { value: "u2" } });
    expect(chartCalls[chartCalls.length - 1]).toMatchObject({ userId: "u2", from: "2026-03-30" });
  });
});

// ── Tabellernas sortering (#1907) ─────────────────────────────────────────

/** Två rader där varje kolumn ger en egen ordning. */
const sortableReport = (over: Record<string, unknown>): Record<string, unknown> => ({
  ...sampleReport,
  matters: [],
  weeklyRows: [{ ...sampleReport.weeklyRows[0], totalMinutes: 0 }],
  unbilled: { rows: [], total: 0 },
  ...over,
});

const ALL_SORTS = ["asc", "desc"] as const;

describe("ReportsPage — sortering per kolumn (#1907)", () => {
  it("Ärenden under perioden sorterar på varje kolumn", () => {
    reportQuery.data = sortableReport({
      matters: [
        { matterId: "m1", matterNumber: "2026-0001", title: "Alfa", client: null, paymentMethod: "PRIVAT",
          totalMinutes: 60, billableMinutes: 120, workValueOre: 300, expenseOre: 0 },
        { matterId: "m2", matterNumber: "2026-0002", title: "Beta", client: "Klient B", paymentMethod: "RATTSHJALP",
          totalMinutes: 120, billableMinutes: 60, workValueOre: 100, expenseOre: 500 },
      ],
    });
    renderAsViewer(<ReportsPage />);
    const order = (): string[] => rowOrder(["2026-0001 — Alfa", "2026-0002 — Beta"]);
    sortColumn("Ärende", "desc");
    expect(order()).toEqual(["2026-0002 — Beta", "2026-0001 — Alfa"]);
    sortColumn("Klient", "asc");
    expect(order()).toEqual(["2026-0001 — Alfa", "2026-0002 — Beta"]);
    sortColumn("Betalning", "desc");
    expect(order()).toEqual(["2026-0002 — Beta", "2026-0001 — Alfa"]);
    sortColumn("Tid (h)", "asc");
    expect(order()).toEqual(["2026-0001 — Alfa", "2026-0002 — Beta"]);
    sortColumn("Deb. tid (h)", "asc");
    expect(order()).toEqual(["2026-0002 — Beta", "2026-0001 — Alfa"]);
    sortColumn("Arbetsvärde", "desc");
    expect(order()).toEqual(["2026-0001 — Alfa", "2026-0002 — Beta"]);
    sortColumn("Utlägg", "desc");
    expect(order()).toEqual(["2026-0002 — Beta", "2026-0001 — Alfa"]);
    // Utan klient står "—", och utlägg 0 visas som "—".
    expect(within(rowWith("2026-0001 — Alfa")).getAllByText("—")).toHaveLength(2);
  });

  it("Timdebitering per vecka sorterar på varje kolumn", () => {
    reportQuery.data = sortableReport({
      weeklyRows: [
        { isoYear: 2026, week: 2, start: "2026-01-05", end: "2026-01-11", totalMinutes: 60, billableMinutes: 0, workValueOre: 0 },
        { isoYear: 2026, week: 10, start: "2026-03-02", end: "2026-03-08", totalMinutes: 0, billableMinutes: 0, workValueOre: 0 },
        { isoYear: 2026, week: 3, start: "2026-01-12", end: "2026-01-18", totalMinutes: 120, billableMinutes: 90, workValueOre: 500 },
      ],
    });
    renderAsViewer(<ReportsPage />);
    const order = (): string[] => rowOrder(["01-05 – 01-11", "03-02 – 03-08", "01-12 – 01-18"]);
    // Vecka sorterar på år och tvåsiffrig vecka: v. 10 efter v. 3.
    sortColumn("Vecka", "asc");
    expect(order()).toEqual(["01-05 – 01-11", "01-12 – 01-18", "03-02 – 03-08"]);
    sortColumn("Period", "desc");
    expect(order()).toEqual(["03-02 – 03-08", "01-12 – 01-18", "01-05 – 01-11"]);
    sortColumn("Tid (h)", "desc");
    expect(order()).toEqual(["01-12 – 01-18", "01-05 – 01-11", "03-02 – 03-08"]);
    for (const dir of ALL_SORTS) {
      sortColumn("Deb. tid (h)", dir);
      sortColumn("Arbetsvärde", dir);
      expect(order()[dir === "asc" ? 2 : 0]).toBe("01-12 – 01-18");
    }
  });

  it("Upparbetat, icke fakturerat sorterar på varje kolumn och varnar för hög risk", () => {
    reportQuery.data = sortableReport({
      unbilled: {
        rows: [
          { matterId: "m1", matterNumber: "2026-0001", title: "Alfa", client: "Klient A", paymentMethod: "RATTSHJALP",
            timeOre: 0, expenseOre: 900, total: 900 },
          { matterId: "m2", matterNumber: "2026-0002", title: "Beta", client: null, paymentMethod: "PRIVAT",
            timeOre: 500, expenseOre: 0, total: 500 },
        ],
        total: 1400,
      },
    });
    renderAsViewer(<ReportsPage />);
    const order = (): string[] => rowOrder(["2026-0001 — Alfa", "2026-0002 — Beta"]);
    sortColumn("Ärende", "desc");
    expect(order()).toEqual(["2026-0002 — Beta", "2026-0001 — Alfa"]);
    sortColumn("Klient", "desc");
    expect(order()).toEqual(["2026-0001 — Alfa", "2026-0002 — Beta"]);
    sortColumn("Betalning", "asc");
    expect(order()).toEqual(["2026-0002 — Beta", "2026-0001 — Alfa"]);
    sortColumn("Tid", "asc");
    expect(order()).toEqual(["2026-0001 — Alfa", "2026-0002 — Beta"]);
    sortColumn("Utlägg", "asc");
    expect(order()).toEqual(["2026-0002 — Beta", "2026-0001 — Alfa"]);
    sortColumn("Summa", "desc");
    expect(order()).toEqual(["2026-0001 — Alfa", "2026-0002 — Beta"]);
    expect(screen.getByText(/av det ofakturerade\s+arbetet ligger under hög eller okänd kreditrisk/)).toBeInTheDocument();
  });
});
