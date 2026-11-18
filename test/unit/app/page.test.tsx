/**
 * Test för Dashboard — Att bevaka + tidrapportering + senaste ärenden, med
 * dagsväxlare (#1167). Kalendern är borttagen (#1623).
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import Dashboard from "@/app/page";

const timeQuery: { data: unknown; isLoading: boolean } = { data: undefined, isLoading: false };
const meQuery: { data: unknown } = { data: { id: "u1", name: "Anna" } };
/** "Att bevaka" (#1062) — tom lista → panelen säger att det är lugnt (#1184). */
const watchlistQuery: { data: unknown; isLoading: boolean } = { data: { items: [] }, isLoading: false };

const completeMutate = vi.fn();

// Dockytan (#1184) kräver en riktig webbläsarlayout — här renderas huvudet och
// alla paneler efter varandra, synkront, så testerna kan granska innehållet.
vi.mock("@/components/layout/panel-page", () => ({
  PanelPage: ({ header, panels }: { header: React.ReactNode; panels: ReadonlyArray<{ id: string; render: () => React.ReactNode }> }) => (
    <>{header}{panels.map((p) => <div key={p.id} data-panel={p.id}>{p.render()}</div>)}</>
  ),
}));

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ watchlist: { list: { invalidate: vi.fn() } }, task: { listForMatter: { invalidate: vi.fn() } } }),
    timeEntry: { list: { useQuery: () => timeQuery } },
    user: { current: { useQuery: () => meQuery } },
    watchlist: { list: { useQuery: () => watchlistQuery } },
    task: {
      // Att bevaka-kortet: bocka av tidsfrister direkt (#1167).
      complete: { useMutation: () => ({ mutate: completeMutate, isPending: false }) },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  timeQuery.data = undefined;
  timeQuery.isLoading = false;
  watchlistQuery.data = { items: [] };
});

describe("Dashboard", () => {
  it("renderar rubrik + panelerna", () => {
    render(<Dashboard />);
    expect(screen.getByRole("heading", { name: /Startsida/i })).toBeInTheDocument();
    expect(screen.queryByText(/Att göra/)).not.toBeInTheDocument(); // samma lista som Att bevaka, borttagen
    expect(screen.getByText(/Tidrapportering/i)).toBeInTheDocument();
    expect(screen.getByText(/Senaste ärenden/i)).toBeInTheDocument();
    expect(screen.getByText("Inget att bevaka just nu.")).toBeInTheDocument();
  });

  it("har ingen Kalender-ruta (#1623)", () => {
    const { container } = render(<Dashboard />);
    expect([...container.querySelectorAll("[data-panel]")].map((e) => e.getAttribute("data-panel"))).toEqual(["watch", "time", "recent"]);
    expect(screen.queryByText(/Kalender/)).not.toBeInTheDocument();
  });

  it("visar dagsväxlare och växlar valt datum", () => {
    render(<Dashboard />);
    const igår = screen.getByRole("button", { name: "Igår" });
    fireEvent.click(igår);
    // "Igår" är nu fokuserad-knapp; verifiera via aktiv klass
    expect(igår.className).toContain("bg-blue-50");
  });

  it("Att bevaka: tidsfrist kan bockas av direkt på startsidan", () => {
    watchlistQuery.data = { items: [{ kind: "deadline", severity: "passed", title: "Tidsfrist passerad: Svaromål", detail: "d", matterId: "m1", matterNumber: "2026-0001", at: "2026-01-01", amountOre: null, link: { route: "matters", id: "m1" }, taskId: "t9" }] };
    render(<Dashboard />);
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

  it("tidsumman ärver rubrikens utseende, Att bevakas räknare är oförändrad (#1673)", () => {
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
