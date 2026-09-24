/**
 * #1162: Att göra & frister i ärendet.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { TodoSection } from "@/app/matters/[id]/_todo-section";
import { asId } from "@/lib/shared/schemas/ids";

const day = (offset: number): Date => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d; };

let tasks: unknown[] = [];
const createMutate = vi.fn();
const completeMutate = vi.fn();
const updateMutate = vi.fn();
const invalidate = { matter: vi.fn(), list: vi.fn(), todo: vi.fn() };
vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({
      task: { listForMatter: { invalidate: invalidate.matter }, list: { invalidate: invalidate.list } },
      todo: { list: { invalidate: invalidate.todo } },
    }),
    user: {
      current: { useQuery: () => ({ data: { id: "me" } }) },
      list: { useQuery: () => ({ data: { users: [{ id: "me", name: "Cecilia" }, { id: "bo", name: "Bo" }] } }) },
    },
    task: {
      listForMatter: { useQuery: () => ({ data: tasks }) },
      create: { useMutation: (o: { onSuccess: () => void }) => ({ mutate: (a: unknown) => { createMutate(a); o.onSuccess(); }, isPending: false }) },
      complete: { useMutation: (o: { onSuccess: () => void }) => ({ mutate: (a: unknown) => { completeMutate(a); o.onSuccess(); }, isPending: false }) },
      update: { useMutation: () => ({ mutate: updateMutate, isPending: false }) },
    },
  },
}));

const M = asId<"MatterId">("m1");
beforeEach(() => { tasks = []; vi.clearAllMocks(); });

describe("TodoSection", () => {
  it("frist i dag lyser rött med stor fet titel och 'FRIST IDAG'", () => {
    tasks = [{ id: "t1", title: "Inkomma med yttrande", dueAt: day(0), status: "TODO", userId: "me" }];
    render(<TodoSection matterId={M} />);
    expect(screen.getByRole("alert")).toHaveTextContent("FRIST IDAG");
    const title = screen.getByText("Inkomma med yttrande");
    expect(title.className).toContain("font-extrabold");
    expect(title.className).toContain("text-red-800");
  });

  it("kommande frist är inte röd; klara döljs tills 'Visa klara'", () => {
    tasks = [
      { id: "t1", title: "Kommande", dueAt: day(4), status: "TODO", userId: "me" },
      { id: "t2", title: "Gjord", dueAt: day(-1), status: "DONE", userId: "me" },
    ];
    render(<TodoSection matterId={M} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Gjord")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Visa klara (1)" }));
    expect(screen.getByText("Gjord")).toBeInTheDocument();
  });

  it("lägg till: titel + fristdatum (lokal midnatt) i ärendet, uppdaterar alla listor", () => {
    render(<TodoSection matterId={M} />);
    fireEvent.change(screen.getByLabelText("Att göra / frist"), { target: { value: "Svaromål" } });
    fireEvent.change(screen.getByLabelText("Frist"), { target: { value: "2026-10-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Lägg till" }));
    expect(createMutate).toHaveBeenCalledWith({ title: "Svaromål", matterId: "m1", dueAt: new Date("2026-10-01T00:00:00") });
    expect(invalidate.matter).toHaveBeenCalled();
    expect(invalidate.list).toHaveBeenCalled(); // startsidans röda ruta
    expect(invalidate.todo).toHaveBeenCalled();
  });

  it("egen uppgift kan bockas av; kollegas är låst och visar ägaren", () => {
    tasks = [
      { id: "t1", title: "Min", dueAt: null, status: "TODO", userId: "me" },
      { id: "t2", title: "Bos", dueAt: null, status: "TODO", userId: "bo" },
    ];
    render(<TodoSection matterId={M} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Markera klar: Min" }));
    expect(completeMutate).toHaveBeenCalledWith({ id: "t1" });
    expect(screen.getByRole("checkbox", { name: "Markera klar: Bos" })).toBeDisabled();
    expect(screen.getByText("(Bo)")).toBeInTheDocument();
  });

  it("klar uppgift återöppnas via task.update", () => {
    tasks = [{ id: "t2", title: "Gjord", dueAt: null, status: "DONE", userId: "me" }];
    render(<TodoSection matterId={M} />);
    fireEvent.click(screen.getByRole("button", { name: "Visa klara (1)" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Återöppna: Gjord" }));
    expect(updateMutate).toHaveBeenCalledWith({ id: "t2", status: "TODO" });
  });
});
