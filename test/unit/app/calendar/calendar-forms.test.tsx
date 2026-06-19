/**
 * CalendarPage (#27) — lista-vyn (EventList/TaskList + badges), samt
 * skapa-flödena (Nytt event → calendar.create, Ny task → task.create) och
 * rad-åtgärder (ta bort event, klar/ta bort task).
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import CalendarPage from "@/app/calendar/page";

const calCreate = vi.fn();
const calDelete = vi.fn();
const taskCreate = vi.fn();
const taskComplete = vi.fn();
const taskDelete = vi.fn();

const eventRows = [
  {
    id: "e1", userId: "u1", title: "Förhandling Tingsrätt", kind: "appointment",
    startAt: new Date("2026-05-20T09:00:00Z"), endAt: new Date("2026-05-20T10:00:00Z"),
    allDay: false, location: "Sal 5", matter: { id: "m1", matterNumber: "2026-0001", title: "Tvist" },
    mirrorToOutlook: true, mirrorStatus: "synced", outlookEventId: "o1", outlookCalendarId: "c1",
  },
];
const taskRows = [
  { id: "t1", title: "Ring klient", status: "TODO", priority: "HIGH", dueAt: new Date("2026-05-21T00:00:00Z"),
    matter: { id: "m1", matterNumber: "2026-0001", title: "Tvist" } },
];
const calListQuery = { data: eventRows as unknown[], isLoading: false };
const taskListQuery = { data: taskRows as unknown[], isLoading: false };

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ calendar: { invalidate: vi.fn(), list: { invalidate: vi.fn() } }, task: { list: { invalidate: vi.fn() } } }),
    user: {
      current: { useQuery: () => ({ data: { id: "u1", name: "Anna", role: "LAWYER" } }) },
      list: { useQuery: () => ({ data: { users: [{ id: "u1", name: "Anna" }] }, isLoading: false }) },
    },
    contacts: { list: { useQuery: () => ({ data: { contacts: [] } }) } },
    matter: { list: { useQuery: () => ({ data: { matters: [] } }) } },
    calendar: {
      list: { useQuery: () => calListQuery },
      listForUsers: { useQuery: () => ({ data: [], isLoading: false }) },
      create: { useMutation: () => ({ mutate: calCreate, isPending: false }) },
      update: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      delete: { useMutation: () => ({ mutate: calDelete, isPending: false }) },
    },
    task: {
      list: { useQuery: () => taskListQuery },
      create: { useMutation: () => ({ mutate: taskCreate, isPending: false }) },
      complete: { useMutation: () => ({ mutate: taskComplete, isPending: false }) },
      delete: { useMutation: () => ({ mutate: taskDelete, isPending: false }) },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  calListQuery.data = eventRows;
  taskListQuery.data = taskRows;
});

describe("CalendarPage — lista + skapa-flöden", () => {
  it("TaskList renderar tasks med prioritets-badge", () => {
    render(<CalendarPage />);
    expect(screen.getByText("Ring klient")).toBeInTheDocument();
    expect(screen.getByText("Hög")).toBeInTheDocument(); // PriorityBadge HIGH
  });

  it("lista-vyn renderar EventList med kind/Outlook-badge", () => {
    render(<CalendarPage />);
    fireEvent.click(screen.getByRole("button", { name: "Lista" }));
    expect(screen.getByText("Förhandling Tingsrätt")).toBeInTheDocument();
    expect(screen.getByText(/Outlook/)).toBeInTheDocument(); // MirrorBadge
  });

  it("'Nytt event' → fyll titel + start → Skapa → calendar.create", () => {
    render(<CalendarPage />);
    fireEvent.click(screen.getByRole("button", { name: /Nytt event/ }));
    fireEvent.change(screen.getByRole("textbox", { name: /Titel/i }) ?? document.querySelector('input[type="text"]')!, { target: { value: "Möte" } });
    const startInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(startInput, { target: { value: "2026-06-01T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: /^Skapa$/ }));
    expect(calCreate).toHaveBeenCalledWith(expect.objectContaining({ title: "Möte" }));
  });

  it("'Ny task' → fyll titel → Skapa → task.create", () => {
    render(<CalendarPage />);
    fireEvent.click(screen.getByRole("button", { name: /Ny task/ }));
    const titleInput = screen.getAllByRole("textbox")[0] as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Skriv inlaga" } });
    fireEvent.click(screen.getByRole("button", { name: /^Skapa$/ }));
    expect(taskCreate).toHaveBeenCalledWith(expect.objectContaining({ title: "Skriv inlaga" }));
  });

  it("task klar-markeras → task.complete; ta bort → confirm → task.delete", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<CalendarPage />);
    fireEvent.click(screen.getByTitle("Markera klar"));
    expect(taskComplete).toHaveBeenCalledWith({ id: "t1" });
    fireEvent.click(screen.getAllByTitle("Ta bort")[0]!);
    expect(taskDelete).toHaveBeenCalledWith({ id: "t1" });
    confirmSpy.mockRestore();
  });
});
