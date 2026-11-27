/**
 * #1162/#1167/#1735: Frister i ärendet.
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest-compat";
import { WatchSection } from "@/app/matters/[id]/_watch-section";
import { asId } from "@/lib/shared/schemas/ids";
import { stockholmDay } from "@/lib/shared/stockholm-time";
import { callsTo, renderWithFakeTrpc } from "../../../helpers/trpc-both-fake";
import { invalidatedPaths, type TrpcHandlers } from "../../../helpers/trpc-fake";

/** Svensk kalenderdag `offset` dagar från i dag (fristen räknas i svensk tid, #1677): en lokal
 *  midnatt gav gårdagen på CI (UTC) mellan 23 och 24 UTC. */
const day = (offset: number): Date => new Date(Date.parse(stockholmDay(new Date())) + offset * 86_400_000);

let tasks: unknown[] = [];
let signals: unknown[] = [];
/** Svaret på `task.delete`; ett löfte som aldrig löses håller raderingen pågående. */
let deleteResult: () => unknown = () => ({ id: "t2" });

const HANDLERS: TrpcHandlers = {
  "task.listForMatter": () => tasks,
  "user.current": () => ({ id: "me" }),
  "user.list": () => ({ users: [{ id: "me", name: "Cecilia" }, { id: "bo", name: "Bo" }] }),
  "watchlist.list": () => ({ items: signals }),
  "task.create": () => ({ id: "t-ny" }),
  "task.complete": () => ({ id: "t1" }),
  "task.update": () => ({ id: "t2" }),
  "task.delete": () => deleteResult(),
};

const M = asId<"MatterId">("m1");
const renderSection = () => renderWithFakeTrpc(<WatchSection matterId={M} />, HANDLERS);
/** Ärendets frister och sidan Frister läses om. */
const REFRESHED = ["task.listForMatter {\"matterId\":\"m1\"}", "watchlist.list"];

vi.mock("@/components/watchlist/conflict-check-actions", () => ({
  ConflictCheckActions: ({ hasHits }: { hasHits: boolean }) => <div data-testid="conflict-actions">{hasHits ? "träffar" : "väntar"}</div>,
}));

vi.mock("@/components/watchlist/conflict-review-info", () => ({
  ConflictReviewInfo: () => <div data-testid="conflict-review" />,
}));

beforeEach(() => { tasks = []; signals = []; deleteResult = () => ({ id: "t2" }); });
afterEach(() => { vi.restoreAllMocks(); });

describe("WatchSection", () => {
  it("frist i dag lyser rött med stor fet titel och 'FRIST IDAG'", async () => {
    tasks = [{ id: "t1", title: "Inkomma med yttrande", dueAt: day(0), status: "TODO", userId: "me" }];
    renderSection();
    expect(await screen.findByRole("alert")).toHaveTextContent("FRIST IDAG");
    const title = screen.getByText("Inkomma med yttrande");
    expect(title.className).toContain("font-extrabold");
    expect(title.className).toContain("text-red-800");
  });

  it("kommande frist är inte röd; klara döljs tills 'Visa klara'", async () => {
    tasks = [
      { id: "t1", title: "Kommande", dueAt: day(4), status: "TODO", userId: "me" },
      { id: "t2", title: "Gjord", dueAt: day(-1), status: "DONE", userId: "me" },
    ];
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Visa klara (1)" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Gjord")).toBeInTheDocument();
  });

  it("klara uppgifter syns inte innan 'Visa klara'", async () => {
    tasks = [{ id: "t2", title: "Gjord", dueAt: day(-1), status: "DONE", userId: "me" }];
    renderSection();
    await screen.findByRole("button", { name: "Visa klara (1)" });
    expect(screen.queryByText("Gjord")).not.toBeInTheDocument();
  });

  it("heter Frister (N) och har tomtext om frister (#1735)", () => {
    renderSection();
    expect(screen.getByRole("region", { name: "Frister" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Frister (0)" })).toBeInTheDocument();
    expect(screen.getByText("Inga öppna frister i ärendet.")).toBeInTheDocument();
  });

  it("lägg till: frist + datum (lokal midnatt) i ärendet, uppdaterar ärendet och sidan Frister", async () => {
    const { fake, invalidate } = renderSection();
    const add = screen.getByRole<HTMLButtonElement>("button", { name: "Lägg till" });
    fireEvent.change(screen.getByLabelText("Frist"), { target: { value: "Överklagandefrist" } });
    expect(add.disabled).toBe(true); // en frist har alltid ett datum
    fireEvent.change(screen.getByLabelText("Datum"), { target: { value: "2026-10-01" } });
    fireEvent.click(add);
    await waitFor(() => expect(invalidatedPaths(invalidate)).toEqual(REFRESHED));
    expect(callsTo(fake, "task.create")).toEqual([{ title: "Överklagandefrist", matterId: "m1", dueAt: new Date("2026-10-01T00:00:00") }]);
    expect(screen.getByLabelText<HTMLInputElement>("Frist").value).toBe("");
  });

  it("visar Bör faktureras ur sidan Frister — men inte tidsfristerna igen", async () => {
    signals = [
      { kind: "unbilled", severity: "approaching", title: "30 000 kr ofakturerat", detail: "d", matterId: "m1", matterNumber: "2026-0001", at: null, amountOre: 3_000_000, link: { route: "matters", id: "m1" } },
      { kind: "deadline", severity: "passed", title: "Tidsfrist passerad: X", detail: "d", matterId: "m1", matterNumber: "2026-0001", at: "2026-01-01", amountOre: null, link: { route: "matters", id: "m1" } },
    ];
    const { fake } = renderSection();
    expect(await screen.findByText("30 000 kr ofakturerat")).toBeInTheDocument();
    expect(callsTo(fake, "watchlist.list")).toEqual([{ mine: false, matterId: "m1" }]);
    expect(screen.queryByText("Tidsfrist passerad: X")).not.toBeInTheDocument();
  });

  it("alla på byrån kan bocka av — även kollegas uppgift; ägaren visas bara som info (#1231)", async () => {
    tasks = [
      { id: "t1", title: "Min", dueAt: null, status: "TODO", userId: "me" },
      { id: "t2", title: "Bos", dueAt: null, status: "TODO", userId: "bo" },
    ];
    const { fake, invalidate } = renderSection();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Markera klar: Min" }));
    const bos = screen.getByRole("checkbox", { name: "Markera klar: Bos" });
    expect(bos).toBeEnabled();
    fireEvent.click(bos);
    await waitFor(() => expect(callsTo(fake, "task.complete")).toEqual([{ id: "t1" }, { id: "t2" }]));
    await waitFor(() => expect(invalidatedPaths(invalidate)).toContain("watchlist.list"));
    expect(await screen.findByText("(Bo)")).toBeInTheDocument();
    expect(screen.queryByText("(Cecilia)")).not.toBeInTheDocument(); // egen: inget namn
  });

  it("Radera: bekräfta → task.delete och ärendet + sidan Frister uppdateras (#1231)", async () => {
    tasks = [{ id: "t2", title: "Dom", dueAt: null, status: "TODO", userId: "bo" }];
    const confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    const { fake, invalidate } = renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Radera: Dom" }));
    expect(confirmSpy).toHaveBeenCalledWith('Radera fristen "Dom"?');
    await waitFor(() => expect(invalidatedPaths(invalidate)).toEqual(REFRESHED));
    expect(callsTo(fake, "task.delete")).toEqual([{ id: "t2" }]);
  });

  it("Radera avbrutet i bekräftelsen → ingen mutation", async () => {
    tasks = [{ id: "t2", title: "Dom", dueAt: null, status: "TODO", userId: "bo" }];
    vi.spyOn(globalThis, "confirm").mockReturnValue(false);
    const { fake } = renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Radera: Dom" }));
    expect(callsTo(fake, "task.delete")).toEqual([]);
  });

  it("Radera är avstängd medan raderingen pågår", async () => {
    tasks = [{ id: "t2", title: "Dom", dueAt: null, status: "TODO", userId: "bo" }];
    deleteResult = () => new Promise(() => {});
    vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    renderSection();
    const remove = await screen.findByRole("button", { name: "Radera: Dom" });
    expect(remove).toBeEnabled();
    fireEvent.click(remove);
    await waitFor(() => expect(remove).toBeDisabled());
  });

  it("klar uppgift återöppnas via task.update", async () => {
    tasks = [{ id: "t2", title: "Gjord", dueAt: null, status: "DONE", userId: "me" }];
    const { fake, invalidate } = renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Visa klara (1)" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Återöppna: Gjord" }));
    await waitFor(() => expect(invalidatedPaths(invalidate)).toEqual(REFRESHED));
    expect(callsTo(fake, "task.update")).toEqual([{ id: "t2", status: "TODO" }]);
  });

  it("visar ingen jävskontroll: varken posten, åtgärderna eller bedömningen — den står under Parter (#1733)", async () => {
    signals = [
      { kind: "conflictCheck", severity: "passed", title: "Jävskontroll: 1 träffar att bedöma", detail: "", matterId: "m1", matterNumber: "1", at: null, amountOre: null, link: null },
      { kind: "unbilled", severity: "approaching", title: "Ofakturerat", detail: "", matterId: "m1", matterNumber: "1", at: null, amountOre: 1, link: null },
    ];
    renderSection();
    expect(await screen.findByText("Ofakturerat")).toBeInTheDocument();
    expect(screen.queryByText(/Jävskontroll/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("conflict-actions")).not.toBeInTheDocument();
    expect(screen.queryByTestId("conflict-review")).not.toBeInTheDocument();
  });

  it("visar bara Bör faktureras under fristerna, inget annat (#1735)", async () => {
    signals = [
      { kind: "coverageCap", severity: "approaching", title: "Närmar sig täckningstaket (85 %)", detail: "", matterId: "m1", matterNumber: "1", at: null, amountOre: null, link: null },
      { kind: "unbilled", severity: "approaching", title: "Bör faktureras", detail: "", matterId: "m1", matterNumber: "1", at: null, amountOre: 1, link: null },
    ];
    renderSection();
    expect(await screen.findByText("Bör faktureras")).toBeInTheDocument();
    expect(screen.queryByText(/täckningstaket/)).not.toBeInTheDocument();
  });

  it("med bara jävskontrollen bland signalerna visas ingen signallista (#1733)", async () => {
    signals = [{ kind: "conflictCheck", severity: "approaching", title: "Jävskontroll väntar", detail: "", matterId: "m1", matterNumber: "1", at: null, amountOre: null, link: null }];
    const { fake } = renderSection();
    await waitFor(() => expect(callsTo(fake, "watchlist.list")).toHaveLength(1));
    await screen.findByRole("heading", { name: "Frister (0)" });
    expect(screen.queryByText("Jävskontroll väntar")).not.toBeInTheDocument();
  });
});
