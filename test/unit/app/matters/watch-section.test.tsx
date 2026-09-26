/**
 * #1162/#1167: Att bevaka i ärendet.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { WatchSection } from "@/app/matters/[id]/_watch-section";
import { asId } from "@/lib/shared/schemas/ids";

const day = (offset: number): Date => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d; };

let tasks: unknown[] = [];
const createMutate = vi.fn();
const completeMutate = vi.fn();
const updateMutate = vi.fn();
const invalidate = { matter: vi.fn(), watchlist: vi.fn() };
let signals: unknown[] = [];
vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({
      task: { listForMatter: { invalidate: invalidate.matter } },
      watchlist: { list: { invalidate: invalidate.watchlist } },
    }),
    watchlist: { list: { useQuery: (args: unknown) => { lastSignalArgs = args; return { data: { items: signals } }; } } },
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

let lastSignalArgs: unknown = null;
const M = asId<"MatterId">("m1");
beforeEach(() => { tasks = []; signals = []; vi.clearAllMocks(); });

describe("WatchSection", () => {
  it("frist i dag lyser rött med stor fet titel och 'FRIST IDAG'", () => {
    tasks = [{ id: "t1", title: "Inkomma med yttrande", dueAt: day(0), status: "TODO", userId: "me" }];
    render(<WatchSection matterId={M} />);
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
    render(<WatchSection matterId={M} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Gjord")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Visa klara (1)" }));
    expect(screen.getByText("Gjord")).toBeInTheDocument();
  });

  it("heter Att bevaka (EN lista med den globala, #1167)", () => {
    render(<WatchSection matterId={M} />);
    expect(screen.getByRole("region", { name: "Att bevaka" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Att bevaka/ })).toBeInTheDocument();
  });

  it("lägg till: bevakning + datum (lokal midnatt) i ärendet, uppdaterar ärendet och globala Att bevaka", () => {
    render(<WatchSection matterId={M} />);
    const add = screen.getByRole("button", { name: "Lägg till" }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText("Bevakning"), { target: { value: "Överklagandefrist" } });
    expect(add.disabled).toBe(true); // en bevakning har alltid ett datum
    fireEvent.change(screen.getByLabelText("Bevakningsdatum"), { target: { value: "2026-10-01" } });
    fireEvent.click(add);
    expect(createMutate).toHaveBeenCalledWith({ title: "Överklagandefrist", matterId: "m1", dueAt: new Date("2026-10-01T00:00:00") });
    expect(invalidate.matter).toHaveBeenCalled();
    expect(invalidate.watchlist).toHaveBeenCalled();
  });

  it("visar ärendets övriga signaler ur globala listan — men inte tidsfristerna igen", () => {
    signals = [
      { kind: "unbilled", severity: "approaching", title: "30 000 kr ofakturerat", detail: "d", matterId: "m1", matterNumber: "2026-0001", at: null, amountOre: 3_000_000, link: { route: "matters", id: "m1" } },
      { kind: "deadline", severity: "passed", title: "Tidsfrist passerad: X", detail: "d", matterId: "m1", matterNumber: "2026-0001", at: "2026-01-01", amountOre: null, link: { route: "matters", id: "m1" } },
    ];
    render(<WatchSection matterId={M} />);
    expect(lastSignalArgs).toEqual({ mine: false, matterId: "m1" });
    expect(screen.getByText("30 000 kr ofakturerat")).toBeInTheDocument();
    expect(screen.queryByText("Tidsfrist passerad: X")).not.toBeInTheDocument();
  });

  it("egen uppgift kan bockas av; kollegas är låst och visar ägaren", () => {
    tasks = [
      { id: "t1", title: "Min", dueAt: null, status: "TODO", userId: "me" },
      { id: "t2", title: "Bos", dueAt: null, status: "TODO", userId: "bo" },
    ];
    render(<WatchSection matterId={M} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Markera klar: Min" }));
    expect(completeMutate).toHaveBeenCalledWith({ id: "t1" });
    expect(screen.getByRole("checkbox", { name: "Markera klar: Bos" })).toBeDisabled();
    expect(screen.getByText("(Bo)")).toBeInTheDocument();
  });

  it("klar uppgift återöppnas via task.update", () => {
    tasks = [{ id: "t2", title: "Gjord", dueAt: null, status: "DONE", userId: "me" }];
    render(<WatchSection matterId={M} />);
    fireEvent.click(screen.getByRole("button", { name: "Visa klara (1)" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Återöppna: Gjord" }));
    expect(updateMutate).toHaveBeenCalledWith({ id: "t2", status: "TODO" });
  });
});
