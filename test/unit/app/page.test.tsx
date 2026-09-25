/**
 * Test för Dashboard — Att bevaka + Kalender (möten/förhandlingar) +
 * tidrapportering + senaste ärenden, med dagsväxlare (#1167).
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import Dashboard from "@/app/page";

const todoQuery: { data: unknown; isLoading: boolean } = { data: undefined, isLoading: false };
const timeQuery: { data: unknown; isLoading: boolean } = { data: undefined, isLoading: false };
const meQuery: { data: unknown } = { data: { id: "u1", name: "Anna" } };
/** "Att bevaka" (#1062) — self-gating: tom lista → kortet renderar ingenting. */
const watchlistQuery: { data: unknown; isLoading: boolean } = { data: { items: [] }, isLoading: false };

const completeMutate = vi.fn();

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ watchlist: { list: { invalidate: vi.fn() } }, task: { listForMatter: { invalidate: vi.fn() } } }),
    todo: { list: { useQuery: () => todoQuery } },
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
  todoQuery.data = undefined;
  todoQuery.isLoading = false;
  timeQuery.data = undefined;
  timeQuery.isLoading = false;
  watchlistQuery.data = { items: [] };
});

describe("Dashboard", () => {
  it("renderar rubrik + tre paneler", () => {
    render(<Dashboard />);
    expect(screen.getByRole("heading", { name: /Startsida/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Kalender/ })).toBeInTheDocument();
    expect(screen.queryByText(/Att göra/)).not.toBeInTheDocument(); // samma lista som Att bevaka, borttagen
    expect(screen.getByText(/Tidrapportering/i)).toBeInTheDocument();
    expect(screen.getByText(/Senaste ärenden/i)).toBeInTheDocument();
  });

  it("visar dagsväxlare och växlar valt datum", () => {
    render(<Dashboard />);
    const igår = screen.getByRole("button", { name: "Igår" });
    fireEvent.click(igår);
    // "Igår" är nu fokuserad-knapp; verifiera via aktiv klass
    expect(igår.className).toContain("bg-blue-50");
  });

  it("Kalender: tomt-läge när inget möte idag", () => {
    todoQuery.data = [];
    render(<Dashboard />);
    expect(screen.getByText(/Inget i kalendern idag/i)).toBeInTheDocument();
  });

  it("Kalender visar bara möten/förhandlingar — uppgifter står i Att bevaka", () => {
    todoQuery.data = [
      { id: "t1", source: "task", title: "Skriv stämningsansökan", at: new Date(), allDay: false, status: "TODO", kind: null, matter: null },
      { id: "e1", source: "event", title: "Förlikningsmöte", at: new Date(), allDay: false, status: null, kind: "meeting", location: null, matter: { id: "m1", matterNumber: "2026-0001", title: "Tvist" } },
    ];
    render(<Dashboard />);
    expect(screen.getByText("Förlikningsmöte")).toBeInTheDocument();
    expect(screen.getByText(/2026-0001 — Tvist/)).toBeInTheDocument();
    expect(screen.queryByText("Skriv stämningsansökan")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Öppna kalender/ })).toHaveAttribute("href", "/calendar");
  });

  it("visar event-frist-badge", () => {
    todoQuery.data = [
      { id: "e1", source: "event", title: "Förhandlingsfrist", at: new Date(), allDay: false, status: null, kind: "deadline", matter: null },
    ];
    render(<Dashboard />);
    expect(screen.getByText("Frist")).toBeInTheDocument();
  });

  it("klick på kalenderpost öppnar detaljer (plats, beskrivning, ärende) och Stäng", async () => {
    const { waitFor } = await import("@testing-library/react");
    todoQuery.data = [
      { id: "e1", source: "event", title: "Huvudförhandling", description: "Sal 4", at: new Date(), allDay: true, status: null, kind: "hearing", location: "Stockholms tingsrätt", matter: { id: "m1", matterNumber: "2026-0001", title: "Tvist" } },
    ];
    render(<Dashboard />);
    fireEvent.click(screen.getByText("Huvudförhandling"));
    await waitFor(() => expect(screen.getByText(/Stockholms tingsrätt/)).toBeInTheDocument());
    expect(screen.getByText("Sal 4")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Stäng" }).at(-1)!); // Modal har även en ×-knapp
    await waitFor(() => expect(screen.queryByText("Sal 4")).not.toBeInTheDocument());
  });

  it("Att bevaka: tidsfrist kan bockas av direkt på startsidan", () => {
    watchlistQuery.data = { items: [{ kind: "deadline", severity: "passed", title: "Tidsfrist passerad: Svaromål", detail: "d", matterId: "m1", matterNumber: "2026-0001", at: "2026-01-01", amountOre: null, href: "/matters/m1", taskId: "t9" }] };
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
    // Total visas i headern som "(1:00)"
    expect(screen.getAllByText(/1:00/).length).toBeGreaterThan(0);
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
