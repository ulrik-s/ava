/**
 * Vy-render-test för todo-listan (#88): vy-växel finns och fungerar, och
 * uppgifter färgkodas mot sin deadline via data-deadline-attributet.
 * (Färg- och vy-LOGIKEN är enhetstestad separat i deadline-color/todo-views.)
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import TodoClient from "@/app/todo/_client";

const createMut = vi.fn();
const updateMut = vi.fn();
const completeMut = vi.fn();
const deleteMut = vi.fn();

const DAY = 86_400_000;
interface Row {
  id: string; source: "task" | "event"; title: string; at: Date; endAt: Date | null;
  allDay: boolean; status: string | null; kind: string | null; location: string | null;
  matter: { id: string; matterNumber: string; title: string } | null;
}
const todoQuery = { data: [] as Row[], isLoading: false };

const row = (over: Partial<Row> = {}): Row => ({
  id: "t1", source: "task", title: "Uppgift", at: new Date(Date.now() + DAY),
  endAt: null, allDay: false, status: "TODO", kind: null, location: null, matter: null, ...over,
});

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ todo: { list: { invalidate: vi.fn() } } }),
    user: {
      list: { useQuery: () => ({ data: { users: [{ id: "u1", name: "Anna" }] } }) },
      current: { useQuery: () => ({ data: { id: "u1", role: "LAWYER" } }) },
    },
    todo: { list: { useQuery: () => todoQuery } },
    matter: { list: { useQuery: () => ({ data: { matters: [] } }) } },
    task: {
      create: { useMutation: () => ({ mutate: createMut, isPending: false }) },
      update: { useMutation: () => ({ mutate: updateMut, isPending: false }) },
      complete: { useMutation: () => ({ mutate: completeMut, isPending: false }) },
      delete: { useMutation: () => ({ mutate: deleteMut, isPending: false }) },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  todoQuery.data = [];
  todoQuery.isLoading = false;
  localStorage.clear();
});

describe("TodoClient — vyer + deadline-färg (#88)", () => {
  it("renderar vy-växeln Dag/Vecka/Månad", () => {
    render(<TodoClient />);
    expect(screen.getByRole("button", { name: "Dag" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vecka" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Månad" })).toBeInTheDocument();
  });

  it("dag-vyn är förvald (aria-pressed)", () => {
    render(<TodoClient />);
    expect(screen.getByRole("button", { name: "Dag" })).toHaveAttribute("aria-pressed", "true");
  });

  it("klick på Vecka byter aktiv vy", () => {
    render(<TodoClient />);
    fireEvent.click(screen.getByRole("button", { name: "Vecka" }));
    expect(screen.getByRole("button", { name: "Vecka" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Dag" })).toHaveAttribute("aria-pressed", "false");
  });

  it("uppgift med nära deadline färgkodas röd, avlägsen grön", () => {
    todoQuery.data = [
      row({ id: "soon", title: "Brådskande", at: new Date(Date.now() + DAY) }),       // < 2d → röd
      row({ id: "later", title: "Senare", at: new Date(Date.now() + 20 * DAY) }),      // ≥ 7d → grön
    ];
    const { container } = render(<TodoClient />);
    const reds = container.querySelectorAll('[data-deadline="red"]');
    const greens = container.querySelectorAll('[data-deadline="green"]');
    expect(reds.length).toBe(1);
    expect(greens.length).toBe(1);
  });

  it("klar uppgift (DONE) får ingen deadline-färg", () => {
    todoQuery.data = [row({ id: "done", status: "DONE", at: new Date(Date.now() + DAY) })];
    const { container } = render(<TodoClient />);
    expect(container.querySelectorAll('[data-deadline="red"]').length).toBe(0);
    expect(container.querySelectorAll('[data-deadline="none"]').length).toBe(1);
  });
});

describe("TodoClient — navigering + CRUD-interaktioner (#27)", () => {
  it("dag-navigering (Föregående/Idag/Nästa/datum) kraschar inte", () => {
    render(<TodoClient />);
    fireEvent.click(screen.getByRole("button", { name: "Nästa" }));
    fireEvent.click(screen.getByRole("button", { name: "Föregående" }));
    fireEvent.click(screen.getByText("Idag"));
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-07-01" } });
    expect(screen.getByText("Idag")).toBeInTheDocument();
  });

  it("toggla en TODO klar → task.complete; en DONE → task.update status TODO", () => {
    todoQuery.data = [row({ id: "t1", status: "TODO" })];
    const { rerender } = render(<TodoClient />);
    fireEvent.click(screen.getByRole("button", { name: "Toggla klar" }));
    expect(completeMut).toHaveBeenCalledWith({ id: "t1" });
    todoQuery.data = [row({ id: "t2", status: "DONE" })];
    rerender(<TodoClient />);
    fireEvent.click(screen.getByRole("button", { name: "Toggla klar" }));
    expect(updateMut).toHaveBeenCalledWith({ id: "t2", status: "TODO" });
  });

  it("'Ny' öppnar modalen, fyll titel + Skapa → task.create", () => {
    render(<TodoClient />);
    fireEvent.click(screen.getByRole("button", { name: "Ny" }));
    expect(screen.getByText("Ny Att-göra")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Ring klient/), { target: { value: "Ring klient" } });
    fireEvent.click(screen.getByRole("button", { name: "Skapa" }));
    expect(createMut).toHaveBeenCalledWith(expect.objectContaining({ title: "Ring klient" }));
  });

  it("Ändra-action öppnar edit-modalen → Spara → task.update med id", () => {
    todoQuery.data = [row({ id: "t9", title: "Befintlig" })];
    render(<TodoClient />);
    fireEvent.click(screen.getByRole("button", { name: "Ändra" }));
    expect(screen.getByText("Ändra Att-göra")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Spara" }));
    expect(updateMut).toHaveBeenCalledWith(expect.objectContaining({ id: "t9" }));
  });

  it("Ta bort med confirm → task.delete med id", () => {
    todoQuery.data = [row({ id: "t5", title: "Radera mig" })];
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<TodoClient />);
    fireEvent.click(screen.getByRole("button", { name: "Ta bort" }));
    expect(deleteMut).toHaveBeenCalledWith({ id: "t5" });
    confirmSpy.mockRestore();
  });

  it("användar-väljaren byter vald medarbetare", () => {
    render(<TodoClient />);
    const userSel = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    const opts = userSel.querySelectorAll("option");
    if (opts.length > 1) {
      fireEvent.change(userSel, { target: { value: (opts[1] as HTMLOptionElement).value } });
      expect(userSel.value).toBe((opts[1] as HTMLOptionElement).value);
    }
  });
});
