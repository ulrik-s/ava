/**
 * Test för Dashboard — Frister + tidrapportering + senaste ärenden, med
 * dagsväxlare (#1167). Kalendern är borttagen (#1623).
 */

import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest-compat";
import Dashboard from "@/app/page";

const timeQuery: { data: unknown; isLoading: boolean } = { data: undefined, isLoading: false };
const meQuery: { data: unknown } = { data: { id: "u1", name: "Anna" } };
/** Det Stapeldiagrammet frågades efter (#2112). */
const chartCalls: Array<{ userId: string; from: string; to: string; granularity: string }> = [];
/** "Frister" (#1062, #1735) — tom lista → panelen säger att det är lugnt (#1184). */
const watchlistQuery: { data: unknown; isLoading: boolean } = { data: { items: [] }, isLoading: false };

const completeMutate = vi.fn();
/** Det tidslistan senast frågades efter: den valda dagens gränser (#2095). */
const timeListInput = vi.fn((_input: { from?: Date; to?: Date }) => timeQuery);

/** Sidhuvudets pil — Stapeldiagrammet har egna pilar med samma namn (#2112). */
function headerArrow(name: "Föregående dag" | "Nästa dag"): HTMLElement {
  const header = screen.getByRole("heading", { name: /Startsida/i }).parentElement?.parentElement;
  if (!header) throw new Error("sidhuvudet saknas");
  return within(header).getByRole("button", { name });
}

// Dockytan (#1184) kräver en riktig webbläsarlayout — här renderas huvudet och
// alla paneler efter varandra, synkront, så testerna kan granska innehållet.
vi.mock("@/components/layout/panel-page", () => ({
  PanelPage: ({ header, panels }: { header: React.ReactNode; panels: ReadonlyArray<{ id: string; render: () => React.ReactNode; fill?: boolean }> }) => (
    <>{header}{panels.map((p) => <div key={p.id} data-panel={p.id} data-fill={String(p.fill)}>{p.render()}</div>)}</>
  ),
}));

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ watchlist: { list: { invalidate: vi.fn() } }, task: { listForMatter: { invalidate: vi.fn() } }, prefs: { get: { invalidate: vi.fn() } } }),
    timeEntry: {
      list: { useQuery: (input: { from?: Date; to?: Date }) => timeListInput(input) },
      chart: {
        useQuery: (input: (typeof chartCalls)[number]) => {
          chartCalls.push(input);
          return { data: { totalMinutes: 0, billableMinutes: 0, bars: [] } };
        },
      },
    },
    prefs: {
      get: { useQuery: () => ({ data: undefined, isLoading: false }) },
      save: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    user: { current: { useQuery: () => meQuery } },
    watchlist: { list: { useQuery: () => watchlistQuery } },
    task: {
      // Frister-kortet: bocka av tidsfrister direkt (#1167).
      complete: { useMutation: () => ({ mutate: completeMutate, isPending: false }) },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  chartCalls.length = 0;
  meQuery.data = { id: "u1", name: "Anna" };
  timeQuery.data = undefined;
  timeQuery.isLoading = false;
  watchlistQuery.data = { items: [] };
});

describe("Dashboard", () => {
  it("renderar rubrik + panelerna", () => {
    render(<Dashboard />);
    expect(screen.getByRole("heading", { name: /Startsida/i })).toBeInTheDocument();
    expect(screen.queryByText(/Att göra/)).not.toBeInTheDocument(); // samma lista som Frister, borttagen
    expect(screen.getByText(/Tidrapportering/i)).toBeInTheDocument();
    expect(screen.getByText(/Senaste ärenden/i)).toBeInTheDocument();
    expect(screen.getByText("Inga frister just nu.")).toBeInTheDocument();
    expect(screen.queryByText(/Att bevaka/)).not.toBeInTheDocument();
  });

  it("varje ruta är en avdelning ut till kanten (fill, #1844)", () => {
    const { container } = render(<Dashboard />);
    const fills = [...container.querySelectorAll("[data-panel]")].map((el) => el.getAttribute("data-fill"));
    expect(fills).toEqual(["true", "true", "true", "true"]);
  });

  it("har ingen Kalender-ruta (#1623)", () => {
    const { container } = render(<Dashboard />);
    expect([...container.querySelectorAll("[data-panel]")].map((e) => e.getAttribute("data-panel"))).toEqual(["watch", "time", "recent", "chart"]);
    expect(screen.queryByText(/Kalender/)).not.toBeInTheDocument();
  });

  it("visar dagsväxlare och växlar valt datum", () => {
    render(<Dashboard />);
    const group = screen.getByRole("group", { name: "Dag" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Idag" })).toHaveAttribute("aria-pressed", "true");
    const igår = screen.getByRole("button", { name: "Igår" });
    fireEvent.click(igår);
    expect(igår).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Idag" })).toHaveAttribute("aria-pressed", "false");
  });

  it("dagsväxlaren: ett annat datum i fältet ger inget valt alternativ (#1805)", () => {
    const { container } = render(<Dashboard />);
    const dateInput = container.querySelector('input[type="date"]');
    if (!(dateInput instanceof HTMLInputElement)) throw new Error("datumfältet saknas");
    fireEvent.change(dateInput, { target: { value: "2001-01-01" } });
    expect(dateInput.value).toBe("2001-01-01");
    for (const name of ["Igår", "Idag", "Imorgon"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("Frister: rutan heter Frister och tidsfrist kan bockas av direkt på startsidan", () => {
    watchlistQuery.data = { items: [{ kind: "deadline", severity: "passed", title: "Tidsfrist passerad: Svaromål", detail: "d", matterId: "m1", matterNumber: "2026-0001", at: "2026-01-01", amountOre: null, link: { route: "matters", id: "m1" }, taskId: "t9" }] };
    render(<Dashboard />);
    expect(screen.getByRole("heading", { name: /🔔 Frister/ })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/FÖRSENAD/);
    fireEvent.click(screen.getByRole("checkbox", { name: "Markera klar: Tidsfrist passerad: Svaromål" }));
    expect(completeMutate).toHaveBeenCalledWith({ id: "t9" });
  });

  it("visar tomt-läge för tidrapportering när inga entries", () => {
    timeQuery.data = { entries: [], totalMinutes: 0 };
    render(<Dashboard />);
    expect(screen.getByText(/Ingen tid registrerad idag/i)).toBeInTheDocument();
  });

  it("listar tidsposter och total", () => {
    timeQuery.data = {
      entries: [
        { id: "te1", minutes: 60, description: "Möte med klient", billable: true,
          matter: { id: "m1", matterNumber: "2026-0001", title: "Tvist" }, date: new Date() },
      ],
      totalMinutes: 60,
    };
    render(<Dashboard />);
    expect(screen.getByText("Möte med klient")).toBeInTheDocument();
    // Decimaltimmar (#1542): raden "1 h" och totalen i headern "(1 h)".
    expect(screen.getByText("1 h")).toBeInTheDocument();
    expect(screen.getByText("(1 h)")).toBeInTheDocument();
  });

  it("tidsumman ärver rubrikens utseende, Fristers räknare är oförändrad (#1673)", () => {
    timeQuery.data = { entries: [], totalMinutes: 60 };
    watchlistQuery.data = { items: [{ kind: "deadline", severity: "passed", title: "Tidsfrist passerad: Svaromål", detail: "d", matterId: "m1", matterNumber: "2026-0001", at: "2026-01-01", amountOre: null, link: { route: "matters", id: "m1" }, taskId: "t9" }] };
    render(<Dashboard />);
    const sum = screen.getByText("(1 h)");
    expect(sum.className).toBe("");
    expect(sum.closest("h2")?.className).toContain("font-semibold text-gray-900");
    expect(screen.getByText("(1, 1 passerade)").className).toBe("text-xs font-normal text-gray-600");
  });

  it("dedupar 'Senaste ärenden' från timeEntries", () => {
    timeQuery.data = {
      entries: [
        { id: "te1", minutes: 30, description: "X", billable: true,
          matter: { id: "m1", matterNumber: "2026-0001", title: "Tvist" }, date: new Date() },
        { id: "te2", minutes: 60, description: "Y", billable: true,
          matter: { id: "m1", matterNumber: "2026-0001", title: "Tvist" }, date: new Date() },
        { id: "te3", minutes: 90, description: "Z", billable: true,
          matter: { id: "m2", matterNumber: "2026-0002", title: "Annat" }, date: new Date() },
      ],
      totalMinutes: 180,
    };
    render(<Dashboard />);
    // "Senaste ärenden"-listan ska visa varje matter en gång (oavsett dubbletter i entries)
    expect(screen.getAllByText(/2026-0001 — Tvist/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2026-0002 — Annat/).length).toBeGreaterThan(0);
  });
});

describe("Dashboard — pilarna stegar en dag i taget (#2095)", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-11-24T12:00:00Z"));
  });
  afterEach(() => {
    vi.setSystemTime();
  });

  const prev = (): HTMLElement => headerArrow("Föregående dag");
  const next = (): HTMLElement => headerArrow("Nästa dag");
  const heading = (): HTMLElement => {
    const label = screen.getByRole("heading", { name: /Startsida/i }).nextElementSibling;
    if (!(label instanceof HTMLElement)) throw new Error("dagnamnet saknas");
    return label;
  };
  const dateInput = (container: HTMLElement): HTMLInputElement => {
    const input = container.querySelector('input[type="date"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("datumfältet saknas");
    return input;
  };
  const pressed = (): string[] =>
    ["Igår", "Idag", "Imorgon"].filter((name) => screen.getByRole("button", { name }).getAttribute("aria-pressed") === "true");
  const follows = (a: Node, b: Node): boolean => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  it("‹ står före dagsvalet och › efter datumfältet", () => {
    const { container } = render(<Dashboard />);
    expect(follows(prev(), screen.getByRole("group", { name: "Dag" }))).toBe(true);
    expect(follows(dateInput(container), next())).toBe(true);
    expect(heading()).toHaveTextContent("Idag");
    expect(heading()).toHaveClass("capitalize");
  });

  it("‹ ger Igår, sedan veckodagen; › tre gånger därifrån ger Imorgon", () => {
    const { container } = render(<Dashboard />);
    fireEvent.click(prev());
    expect(heading()).toHaveTextContent("Igår");
    expect(pressed()).toEqual(["Igår"]);
    expect(dateInput(container).value).toBe("2026-11-23");
    const inputs: Array<{ from?: Date }> = timeListInput.mock.calls.map((call: [{ from?: Date }]) => call[0]);
    const dayQueries = inputs.map((input) => input.from).filter((from) => from !== undefined);
    expect(dayQueries.at(-1)).toEqual(new Date("2026-11-23T00:00:00"));
    fireEvent.click(prev());
    expect(heading()).toHaveTextContent("söndag 22 november 2026");
    expect(pressed()).toEqual([]);
    fireEvent.click(next());
    fireEvent.click(next());
    fireEvent.click(next());
    expect(pressed()).toEqual(["Imorgon"]);
  });

  it("pilarna stegar från ett datum som valts i fältet", () => {
    const { container } = render(<Dashboard />);
    fireEvent.change(dateInput(container), { target: { value: "2001-01-01" } });
    fireEvent.click(next());
    expect(dateInput(container).value).toBe("2001-01-02");
  });

  it("ett tömt datumfält stänger av pilarna och lämnar dagnamnet tomt", () => {
    const { container } = render(<Dashboard />);
    fireEvent.change(dateInput(container), { target: { value: "" } });
    expect(prev()).toBeDisabled();
    expect(next()).toBeDisabled();
    expect(heading()).toHaveTextContent("");
  });
});

describe("Dashboard — Stapeldiagram med egna tider från i dag (#2112)", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-11-24T12:00:00Z"));
  });
  afterEach(() => {
    vi.setSystemTime();
  });

  it("rutan finns och frågar efter den inloggades vecka som innehåller i dag", () => {
    const { container } = render(<Dashboard />);
    expect(container.querySelector('[data-panel="chart"]')).not.toBeNull();
    expect(chartCalls.at(-1)).toEqual({ userId: "u1", from: "2026-11-23", to: "2026-11-29", granularity: "day" });
  });

  it("ingen fråga innan user.current har svarat — rutan säger Laddar...", () => {
    meQuery.data = undefined;
    const { container } = render(<Dashboard />);
    expect(chartCalls).toHaveLength(0);
    expect(container.querySelector('[data-panel="chart"]')).toHaveTextContent("Laddar...");
  });

  it("dagväljaren i sidhuvudet ändrar inte diagrammets fråga", () => {
    render(<Dashboard />);
    fireEvent.click(screen.getByRole("button", { name: "Igår" }));
    fireEvent.click(headerArrow("Föregående dag"));
    const periods = new Set(chartCalls.map((c) => `${c.from}..${c.to}`));
    expect([...periods]).toEqual(["2026-11-23..2026-11-29"]);
  });
});
