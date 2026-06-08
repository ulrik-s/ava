/**
 * Vy-render-test för todo-listan (#88): vy-växel finns och fungerar, och
 * uppgifter färgkodas mot sin deadline via data-deadline-attributet.
 * (Färg- och vy-LOGIKEN är enhetstestad separat i deadline-color/todo-views.)
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { render, screen, fireEvent } from "@testing-library/react";
import TodoClient from "@/app/todo/_client";

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
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      update: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      complete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
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
