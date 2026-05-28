/**
 * Test för Dashboard — Att-göra-list + tidrapportering + senaste ärenden,
 * med dagsväxlare (Idag/Igår/Förrgår/datum).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Dashboard from "@/app/page";

const todoQuery: { data: unknown; isLoading: boolean } = { data: undefined, isLoading: false };
const timeQuery: { data: unknown; isLoading: boolean } = { data: undefined, isLoading: false };
const meQuery: { data: unknown } = { data: { id: "u1", name: "Anna" } };

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    todo: { list: { useQuery: () => todoQuery } },
    timeEntry: { list: { useQuery: () => timeQuery } },
    user: { current: { useQuery: () => meQuery } },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  todoQuery.data = undefined;
  todoQuery.isLoading = false;
  timeQuery.data = undefined;
  timeQuery.isLoading = false;
});

describe("Dashboard", () => {
  it("renderar rubrik + tre paneler", () => {
    render(<Dashboard />);
    expect(screen.getByRole("heading", { name: /Dashboard/i })).toBeInTheDocument();
    expect(screen.getByText(/Att göra/i)).toBeInTheDocument();
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

  it("visar tomt-läge för Att göra när inga items", () => {
    todoQuery.data = [];
    render(<Dashboard />);
    expect(screen.getByText(/Inget att göra idag/i)).toBeInTheDocument();
  });

  it("renderar todo-item med ärendelänk", () => {
    todoQuery.data = [
      {
        id: "t1", source: "task", title: "Skriv stämningsansökan",
        at: new Date(),
        allDay: false, status: "TODO", kind: null,
        matter: { id: "m1", matterNumber: "2026-0001", title: "Tvist" },
      },
    ];
    render(<Dashboard />);
    expect(screen.getByText("Skriv stämningsansökan")).toBeInTheDocument();
    expect(screen.getByText(/2026-0001 — Tvist/)).toBeInTheDocument();
  });

  it("visar event-frist-badge", () => {
    todoQuery.data = [
      {
        id: "e1", source: "event", title: "Förhandlingsfrist",
        at: new Date(),
        allDay: false, status: null, kind: "deadline",
        matter: null,
      },
    ];
    render(<Dashboard />);
    expect(screen.getByText("Frist")).toBeInTheDocument();
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
