/**
 * #1162/#1167/#1735: Frister i ärendet.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { WatchSection } from "@/app/matters/[id]/_watch-section";
import { asId } from "@/lib/shared/schemas/ids";
import { stockholmDay } from "@/lib/shared/stockholm-time";

/** Svensk kalenderdag `offset` dagar från i dag (fristen räknas i svensk tid, #1677): en lokal
 *  midnatt gav gårdagen på CI (UTC) mellan 23 och 24 UTC. */
const day = (offset: number): Date => new Date(Date.parse(stockholmDay(new Date())) + offset * 86_400_000);

let tasks: unknown[] = [];
const createMutate = vi.fn();
const completeMutate = vi.fn();
const updateMutate = vi.fn();
const deleteMutate = vi.fn();
let deletePending = false;
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
      delete: { useMutation: (o: { onSuccess: () => void }) => ({ mutate: (a: unknown) => { deleteMutate(a); o.onSuccess(); }, isPending: deletePending }) },
    },
  },
}));

vi.mock("@/components/watchlist/conflict-check-actions", () => ({
  ConflictCheckActions: ({ hasHits }: { hasHits: boolean }) => <div data-testid="conflict-actions">{hasHits ? "träffar" : "väntar"}</div>,
}));

vi.mock("@/components/watchlist/conflict-review-info", () => ({
  ConflictReviewInfo: () => <div data-testid="conflict-review" />,
}));

let lastSignalArgs: unknown = null;
const M = asId<"MatterId">("m1");
beforeEach(() => { tasks = []; signals = []; deletePending = false; vi.clearAllMocks(); });

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

  it("heter Frister (N) och har tomtext om frister (#1735)", () => {
    render(<WatchSection matterId={M} />);
    expect(screen.getByRole("region", { name: "Frister" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Frister (0)" })).toBeInTheDocument();
    expect(screen.getByText("Inga öppna frister i ärendet.")).toBeInTheDocument();
  });

  it("lägg till: frist + datum (lokal midnatt) i ärendet, uppdaterar ärendet och sidan Frister", () => {
    render(<WatchSection matterId={M} />);
    const add = screen.getByRole<HTMLButtonElement>("button", { name: "Lägg till" });
    fireEvent.change(screen.getByLabelText("Frist"), { target: { value: "Överklagandefrist" } });
    expect(add.disabled).toBe(true); // en frist har alltid ett datum
    fireEvent.change(screen.getByLabelText("Datum"), { target: { value: "2026-10-01" } });
    fireEvent.click(add);
    expect(createMutate).toHaveBeenCalledWith({ title: "Överklagandefrist", matterId: "m1", dueAt: new Date("2026-10-01T00:00:00") });
    expect(invalidate.matter).toHaveBeenCalled();
    expect(invalidate.watchlist).toHaveBeenCalled();
  });

  it("visar Bör faktureras ur sidan Frister — men inte tidsfristerna igen", () => {
    signals = [
      { kind: "unbilled", severity: "approaching", title: "30 000 kr ofakturerat", detail: "d", matterId: "m1", matterNumber: "2026-0001", at: null, amountOre: 3_000_000, link: { route: "matters", id: "m1" } },
      { kind: "deadline", severity: "passed", title: "Tidsfrist passerad: X", detail: "d", matterId: "m1", matterNumber: "2026-0001", at: "2026-01-01", amountOre: null, link: { route: "matters", id: "m1" } },
    ];
    render(<WatchSection matterId={M} />);
    expect(lastSignalArgs).toEqual({ mine: false, matterId: "m1" });
    expect(screen.getByText("30 000 kr ofakturerat")).toBeInTheDocument();
    expect(screen.queryByText("Tidsfrist passerad: X")).not.toBeInTheDocument();
  });

  it("alla på byrån kan bocka av — även kollegas uppgift; ägaren visas bara som info (#1231)", () => {
    tasks = [
      { id: "t1", title: "Min", dueAt: null, status: "TODO", userId: "me" },
      { id: "t2", title: "Bos", dueAt: null, status: "TODO", userId: "bo" },
    ];
    render(<WatchSection matterId={M} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Markera klar: Min" }));
    expect(completeMutate).toHaveBeenCalledWith({ id: "t1" });
    const bos = screen.getByRole("checkbox", { name: "Markera klar: Bos" });
    expect(bos).toBeEnabled();
    fireEvent.click(bos);
    expect(completeMutate).toHaveBeenCalledWith({ id: "t2" });
    expect(screen.getByText("(Bo)")).toBeInTheDocument();
    expect(screen.queryByText("(Cecilia)")).not.toBeInTheDocument(); // egen: inget namn
  });

  it("Radera: bekräfta → task.delete och ärendet + sidan Frister uppdateras (#1231)", () => {
    tasks = [{ id: "t2", title: "Dom", dueAt: null, status: "TODO", userId: "bo" }];
    const confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    render(<WatchSection matterId={M} />);
    fireEvent.click(screen.getByRole("button", { name: "Radera: Dom" }));
    expect(confirmSpy).toHaveBeenCalledWith('Radera fristen "Dom"?');
    expect(deleteMutate).toHaveBeenCalledWith({ id: "t2" });
    expect(invalidate.matter).toHaveBeenCalledWith({ matterId: "m1" });
    expect(invalidate.watchlist).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("Radera avbrutet i bekräftelsen → ingen mutation", () => {
    tasks = [{ id: "t2", title: "Dom", dueAt: null, status: "TODO", userId: "bo" }];
    const confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(false);
    render(<WatchSection matterId={M} />);
    fireEvent.click(screen.getByRole("button", { name: "Radera: Dom" }));
    expect(deleteMutate).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("Radera är avstängd medan raderingen pågår", () => {
    tasks = [{ id: "t2", title: "Dom", dueAt: null, status: "TODO", userId: "bo" }];
    deletePending = true;
    render(<WatchSection matterId={M} />);
    expect(screen.getByRole("button", { name: "Radera: Dom" })).toBeDisabled();
  });

  it("klar uppgift återöppnas via task.update", () => {
    tasks = [{ id: "t2", title: "Gjord", dueAt: null, status: "DONE", userId: "me" }];
    render(<WatchSection matterId={M} />);
    fireEvent.click(screen.getByRole("button", { name: "Visa klara (1)" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Återöppna: Gjord" }));
    expect(updateMutate).toHaveBeenCalledWith({ id: "t2", status: "TODO" });
  });

  it("visar ingen jävskontroll: varken posten, åtgärderna eller bedömningen — den står under Parter (#1733)", () => {
    signals = [
      { kind: "conflictCheck", severity: "passed", title: "Jävskontroll: 1 träffar att bedöma", detail: "", matterId: "m1", matterNumber: "1", at: null, amountOre: null, link: null },
      { kind: "unbilled", severity: "approaching", title: "Ofakturerat", detail: "", matterId: "m1", matterNumber: "1", at: null, amountOre: 1, link: null },
    ];
    render(<WatchSection matterId={M} />);
    expect(screen.getByText("Ofakturerat")).toBeInTheDocument();
    expect(screen.queryByText(/Jävskontroll/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("conflict-actions")).not.toBeInTheDocument();
    expect(screen.queryByTestId("conflict-review")).not.toBeInTheDocument();
  });

  it("visar bara Bör faktureras under fristerna, inget annat (#1735)", () => {
    signals = [
      { kind: "coverageCap", severity: "approaching", title: "Närmar sig täckningstaket (85 %)", detail: "", matterId: "m1", matterNumber: "1", at: null, amountOre: null, link: null },
      { kind: "unbilled", severity: "approaching", title: "Bör faktureras", detail: "", matterId: "m1", matterNumber: "1", at: null, amountOre: 1, link: null },
    ];
    render(<WatchSection matterId={M} />);
    expect(screen.getByText("Bör faktureras")).toBeInTheDocument();
    expect(screen.queryByText(/täckningstaket/)).not.toBeInTheDocument();
  });

  it("med bara jävskontrollen bland signalerna visas ingen signallista (#1733)", () => {
    signals = [{ kind: "conflictCheck", severity: "approaching", title: "Jävskontroll väntar", detail: "", matterId: "m1", matterNumber: "1", at: null, amountOre: null, link: null }];
    render(<WatchSection matterId={M} />);
    expect(screen.queryByText("Jävskontroll väntar")).not.toBeInTheDocument();
  });
});
