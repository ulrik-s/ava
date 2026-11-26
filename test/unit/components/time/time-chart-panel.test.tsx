/**
 * `TimeChartPanel` (#2110) — rutan Stapeldiagram: vyval, period, staplar och
 * den valda stapelns ärenden. `timeEntry.chart` mockas och sparar sina indata;
 * svaret byggs med den riktiga `buildTimeChart`.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { buildTimeChart, type TimeChartEntry, type TimeChartGranularity } from "@/lib/shared/time-chart";

interface ChartInput { userId: string; from: string; to: string; granularity: TimeChartGranularity }

const calls: ChartInput[] = [];
const state = { entries: [] as TimeChartEntry[], loading: false };

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    timeEntry: {
      chart: {
        useQuery: (input: ChartInput) => {
          calls.push(input);
          return { data: state.loading ? undefined : buildTimeChart({ entries: state.entries, ...input }) };
        },
      },
    },
  },
}));

const { TimeChartPanel } = await import("@/components/time/time-chart-panel");
const { asId } = await import("@/lib/shared/schemas/ids");

const USER = asId<"UserId">("u1");
const M1 = { id: "m1", matterNumber: "2026-0016", title: "Bodelning" };
const M2 = { id: "m2", matterNumber: "2026-0002", title: "Vårdnad" };

function entry(date: string, minutes: number, billable: boolean, matter: TimeChartEntry["matter"]): TimeChartEntry {
  return { date: `${date}T10:00:00Z`, minutes, billable, matter };
}

function lastCall(): ChartInput | undefined {
  return calls[calls.length - 1];
}

beforeEach(() => {
  calls.length = 0;
  state.loading = false;
  state.entries = [
    entry("2026-11-23", 390, true, M1),
    entry("2026-11-24", 180, false, M2),
    entry("2026-11-24", 60, true, M1),
    entry("2026-11-24", 30, true, null),
  ];
});

describe("TimeChartPanel", () => {
  it("visar veckan måndag–söndag med dagsstaplar som förval, med rubrik och summor", () => {
    render(<TimeChartPanel userId={USER} anchorDay="2026-11-24" />);
    expect(lastCall()).toEqual({ userId: "u1", from: "2026-11-23", to: "2026-11-29", granularity: "day" });
    expect(screen.getByRole("button", { name: "Vecka" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Vecka 48 2026 · Totalt 11 h · Debiterbart 8 h");
    expect(screen.getByRole("button", { name: "Måndag 23 november: 6,5 h" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Tisdag 24 november: 4,5 h" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("button", { name: /november: 0 h$/ })).toHaveLength(5);
  });

  it("visar den valda stapelns period, summor och ärenden som länkar, utan tid per ärende", () => {
    render(<TimeChartPanel userId={USER} anchorDay="2026-11-24" />);
    expect(screen.getByText("2026-11-24")).toBeInTheDocument();
    expect(screen.getByText(/Totalt 4,5 h · Debiterbart 1,5 h/)).toBeInTheDocument();
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["2026-0002 — Vårdnad", "2026-0016 — Bodelning"]);
    expect(links[0]?.getAttribute("href")).toContain("m2");
  });

  it("ett klick på en stapel visar den stapelns ärenden", () => {
    render(<TimeChartPanel userId={USER} anchorDay="2026-11-24" />);
    fireEvent.click(screen.getByRole("button", { name: "Måndag 23 november: 6,5 h" }));
    expect(screen.getByRole("button", { name: "Måndag 23 november: 6,5 h" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Totalt 6,5 h · Debiterbart 6,5 h/)).toBeInTheDocument();
    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual(["2026-0016 — Bodelning"]);
  });

  it("Dag visar dagen som en stapel och behåller den valda dagen", () => {
    render(<TimeChartPanel userId={USER} anchorDay="2026-11-24" />);
    fireEvent.click(screen.getByRole("button", { name: "Dag" }));
    expect(lastCall()).toEqual({ userId: "u1", from: "2026-11-24", to: "2026-11-24", granularity: "day" });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/^tisdag 24 november 2026 · Totalt 4,5 h/);
  });

  it("Månad visar månadens veckor och År årets månader, med samma valda dag", () => {
    render(<TimeChartPanel userId={USER} anchorDay="2026-11-24" />);
    fireEvent.click(screen.getByRole("button", { name: "Månad" }));
    expect(lastCall()).toEqual({ userId: "u1", from: "2026-11-01", to: "2026-11-30", granularity: "week" });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/^november 2026 · /);
    expect(screen.getByRole("button", { name: "Vecka 48: 11 h" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("2026-11-23 – 2026-11-29")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "År" }));
    expect(lastCall()).toEqual({ userId: "u1", from: "2026-01-01", to: "2026-12-31", granularity: "month" });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/^2026 · /);
    expect(screen.getByRole("button", { name: "November 2026: 11 h" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("button", { name: /2026: / })).toHaveLength(12);
  });

  it("ett klick på en stapel i Månad gör stapelns första dag till vald dag", () => {
    render(<TimeChartPanel userId={USER} anchorDay="2026-11-24" />);
    fireEvent.click(screen.getByRole("button", { name: "Månad" }));
    fireEvent.click(screen.getByRole("button", { name: "Vecka 45: 0 h" }));
    fireEvent.click(screen.getByRole("button", { name: "Dag" }));
    expect(lastCall()).toMatchObject({ from: "2026-11-02", to: "2026-11-02" });
  });

  it("en period utan tid visar Ingen tid registrerad.", () => {
    state.entries = [];
    render(<TimeChartPanel userId={USER} anchorDay="2026-11-24" />);
    expect(screen.getByText("Ingen tid registrerad.")).toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("visar Laddar... medan frågan laddar", () => {
    state.loading = true;
    render(<TimeChartPanel userId={USER} anchorDay="2026-11-24" />);
    expect(screen.getByText("Laddar...")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/^Vecka 48 2026$/);
  });

  it("ett nytt anchorDay flyttar perioden", () => {
    const { rerender } = render(<TimeChartPanel userId={USER} anchorDay="2026-11-24" />);
    rerender(<TimeChartPanel userId={USER} anchorDay="2026-12-02" />);
    expect(lastCall()).toMatchObject({ from: "2026-11-30", to: "2026-12-06" });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/^Vecka 49 2026/);
  });
});
