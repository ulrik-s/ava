/**
 * Sammanslagen sökning i ärendelistan (#1642): live-filtrering medan man
 * skriver, jävskontroll vid Sök/Enter, en lista med kolumnen "Träff",
 * status för jävsträffarnas rader och jävmärkningen.
 */

import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import MattersPage from "@/app/matters/page";
import { rowOrder, sortColumn } from "../../../helpers/data-table";
import { callsTo, DATA_TABLE_HANDLERS, renderWithFakeTrpc } from "../../../helpers/trpc-both-fake";
import type { FakeTrpcLink } from "../../../helpers/trpc-fake";

type Row = Record<string, unknown>;
const row = (id: string, over: Row = {}): Row => ({
  id, matterNumber: `2026-000${id}`, title: `Ärende ${id}`, status: "ACTIVE",
  contacts: [], parties: [], _count: { contacts: 0 }, ...over,
});

let listMatters: Row[] = [];
let conflictMatters: Row[] = [];
type CheckResult = { searchTerm: string; matchCount: number; results: Row[] };
/** `conflict.check`: svaret, eller ett löfte som testet styr. */
let check: (input: unknown) => CheckResult | Promise<CheckResult> = () => ({ searchTerm: "", matchCount: 0, results: [] });

/** `flik` i adressen: de flesta fallen gäller Alla ärenden på byrån (#1968). */
let flik: string | null = "alla";
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: (k: string) => (k === "flik" ? flik : null) }),
  useRouter: () => ({ replace: vi.fn() }),
}));

function hasIds(input: unknown): boolean {
  return typeof input === "object" && input !== null && "ids" in input;
}

/** Sidan under en fejkad tRPC-länk; listan svarar ur `listMatters`/`conflictMatters`. */
function renderPage(): FakeTrpcLink {
  return renderWithFakeTrpc(<MattersPage />, {
    "matter.list": (input) => ({ matters: hasIds(input) ? conflictMatters : listMatters, total: 0, pages: 1 }),
    "conflict.check": (input) => check(input),
    "contacts.search": () => ({ contacts: [] }),
    "organization.getSettings": () => ({ matterTypes: [] }),
    "user.list": () => ({ users: [] }),
    ...DATA_TABLE_HANDLERS,
  }).fake;
}

/** Sidan med listan inläst. */
async function renderLoaded(): Promise<FakeTrpcLink> {
  const fake = renderPage();
  const first = listMatters[0]?.title;
  await screen.findByText(typeof first === "string" ? first : "Inga ärenden.");
  return fake;
}

/** Skriver `term` och trycker Sök; väntar tills Träff-kolumnen kommit. */
async function search(term: string): Promise<void> {
  fireEvent.change(searchBox(), { target: { value: term } });
  fireEvent.click(screen.getByRole("button", { name: "Sök" }));
  await waitFor(() => expect(columnHeaders().some((h) => h.includes("Träff"))).toBe(true));
}

const checks = (fake: FakeTrpcLink): unknown[] => callsTo(fake, "conflict.check");
const idLists = (fake: FakeTrpcLink): unknown[] => callsTo(fake, "matter.list").filter(hasIds);

const searchBox = (): HTMLInputElement => screen.getByPlaceholderText<HTMLInputElement>(/Sök ärenden/);
const columnHeaders = (): string[] => screen.getAllByRole("columnheader").map((h) => h.textContent);
const bodyRows = (): HTMLElement[] => screen.getAllByRole("row").filter((r) => within(r).queryAllByRole("cell").length > 0);
/** Rad nr `i` i tabellkroppen (kastar om den saknas — testet ska då fallera). */
const bodyRow = (i: number): HTMLElement => {
  const r = bodyRows()[i];
  if (!r) throw new Error(`rad ${i} saknas`);
  return r;
};

beforeEach(() => {
  flik = "alla";
  listMatters = [row("1"), row("2")];
  conflictMatters = [];
  check = () => ({ searchTerm: "", matchCount: 0, results: [] });
});

describe("Ärendelistan — sammanslagen sökning (#1642)", () => {
  it("före sökning: listan som i dag, utan Träff-kolumn och utan jävmärkning", async () => {
    await renderLoaded();
    expect(columnHeaders().some((h) => h.includes("Träff"))).toBe(false);
    expect(columnHeaders().some((h) => h.includes("Parter"))).toBe(true);
    expect(screen.queryByText(/träff\(ar\)|Inga träffar/)).toBeNull();
    expect(screen.getByRole("option", { name: "Alla statusar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sök" })).toBeDisabled();
  });

  it("att skriva filtrerar live utan att köra jävskontrollen", async () => {
    const fake = await renderLoaded();
    fireEvent.change(searchBox(), { target: { value: "anna" } });
    await waitFor(() => expect(callsTo(fake, "matter.list")).toContainEqual(expect.objectContaining({ search: "anna" })));
    expect(checks(fake)).toEqual([]);
  });

  it("Sök kör conflict.check en gång med den trimmade texten (namn + nummer)", async () => {
    const fake = await renderLoaded();
    fireEvent.change(searchBox(), { target: { value: " Anna Andersson " } });
    fireEvent.click(screen.getByRole("button", { name: "Sök" }));
    await waitFor(() => expect(checks(fake)).toEqual([{ searchTerm: "Anna Andersson", searchType: "both" }]));
  });

  it("Enter i sökrutan kör conflict.check en gång", async () => {
    const fake = await renderLoaded();
    fireEvent.change(searchBox(), { target: { value: "Anna" } });
    fireEvent.submit(searchBox());
    await waitFor(() => expect(checks(fake)).toEqual([{ searchTerm: "Anna", searchType: "both" }]));
  });

  it("bara blanksteg kör ingen jävskontroll", async () => {
    const fake = await renderLoaded();
    fireEvent.change(searchBox(), { target: { value: "   " } });
    fireEvent.submit(searchBox());
    await new Promise((r) => setTimeout(r, 20));
    expect(checks(fake)).toEqual([]);
  });

  it("efter sökning: jävsträffarnas ärenden överst med status, ett ärende per rad, Träff-kolumnen och märkningen", async () => {
    listMatters = [row("1", { title: "Anna mot Bo" }), row("2")];
    conflictMatters = [row("3", { status: "CLOSED", title: "Gammalt ärende" }), row("1", { title: "Anna mot Bo" })];
    check = () => ({
      searchTerm: "Anna",
      matchCount: 2,
      results: [
        { matterId: "3", contactName: "Anna Andersson", role: "MOTPART", personalNumber: "19800101-1234", orgNumber: null },
        { matterId: "1", contactName: "Anna Andersson", role: "MOTPART", personalNumber: null, orgNumber: null },
      ],
    });
    const fake = await renderLoaded();
    await search("Anna");
    await screen.findByText("Gammalt ärende");
    expect(idLists(fake)).toEqual([{ ids: ["3", "1"], page: 1, pageSize: 2 }]);
    expect(screen.getByText("2 träff(ar) — bedöm om jäv föreligger")).toBeInTheDocument();

    expect(bodyRows()).toHaveLength(3);
    expect(within(bodyRow(0)).getByText("Gammalt ärende")).toBeInTheDocument();
    expect(within(bodyRow(0)).getByText("Stängt")).toBeInTheDocument();
    expect(within(bodyRow(0)).getByText("Motpart: Anna Andersson (19800101-1234)")).toBeInTheDocument();
    // Ärende 1 matchar både på titeln och via en part — en rad, båda träffarna.
    expect(within(bodyRow(1)).getByText("Titel")).toBeInTheDocument();
    expect(within(bodyRow(1)).getByText("Motpart: Anna Andersson")).toBeInTheDocument();
    expect(within(bodyRow(2)).getByText("Ärende 2")).toBeInTheDocument();
  });

  it("en part vars namn innehåller termen visas i Träff, också utan jävsträff på samma part (#1870)", async () => {
    listMatters = [row("1", { parties: [{ role: "KLIENT", name: "Bo Berg" }, { role: "MOTPART", name: "Byggfirma Stenhammar AB" }] }), row("2")];
    check = () => ({ searchTerm: "stenham", matchCount: 0, results: [] });
    await renderLoaded();
    await search("stenham");
    expect(within(bodyRow(0)).getByText("Motpart: Byggfirma Stenhammar AB")).toBeInTheDocument();
    expect(within(bodyRow(0)).queryByText(/Klient:/)).toBeNull();
  });

  it("Träff-kolumnen sorterar på träffarnas text (#1903)", async () => {
    listMatters = [
      row("1", { parties: [{ role: "MOTPART", name: "Stenhammar Bygg" }] }),
      row("2"),
      row("3", { parties: [{ role: "KLIENT", name: "Anna Stenhammar" }] }),
    ];
    check = () => ({ searchTerm: "stenham", matchCount: 0, results: [] });
    await renderLoaded();
    await search("stenham");
    sortColumn("Träff", "desc");
    expect(rowOrder(["Ärende 1", "Ärende 2", "Ärende 3"])).toEqual(["Ärende 1", "Ärende 3", "Ärende 2"]);
    sortColumn("Träff", "asc");
    expect(rowOrder(["Ärende 1", "Ärende 2", "Ärende 3"])).toEqual(["Ärende 2", "Ärende 3", "Ärende 1"]);
  });

  it("inga jävsträffar: märkningen 'Inga träffar' och listan med Träff-kolumnen; inget id-anrop", async () => {
    check = () => ({ searchTerm: "Ärende 2", matchCount: 0, results: [] });
    const fake = await renderLoaded();
    await search("Ärende 2");
    expect(screen.getByText("Inga träffar")).toBeInTheDocument();
    expect(idLists(fake)).toEqual([]);
    expect(bodyRows()).toHaveLength(2);
    expect(within(bodyRow(1)).getByText("Titel")).toBeInTheDocument();
  });

  it("rensas sökrutan glöms sökningen (kolumnen och märkningen försvinner)", async () => {
    check = () => ({ searchTerm: "Anna", matchCount: 0, results: [] });
    await renderLoaded();
    await search("Anna");
    fireEvent.change(searchBox(), { target: { value: "" } });
    expect(searchBox().value).toBe("");
    await waitFor(() => expect(columnHeaders().some((h) => h.includes("Träff"))).toBe(false));
    expect(screen.queryByText("Inga träffar")).toBeNull();
  });

  it("en ny sökterm glömmer jävskontrollen (kolumnen och märkningen försvinner)", async () => {
    check = () => ({ searchTerm: "Anna", matchCount: 0, results: [] });
    await renderLoaded();
    await search("Anna");
    expect(screen.getByText("Inga träffar")).toBeInTheDocument();
    fireEvent.change(searchBox(), { target: { value: "Bo" } });
    expect(searchBox().value).toBe("Bo");
    await waitFor(() => expect(columnHeaders().some((h) => h.includes("Träff"))).toBe(false));
    expect(screen.queryByText("Inga träffar")).toBeNull();
  });

  it("medan jävskontrollen pågår visar knappen 'Söker...'", async () => {
    check = () => new Promise(() => {});
    await renderLoaded();
    fireEvent.change(searchBox(), { target: { value: "Anna" } });
    fireEvent.click(screen.getByRole("button", { name: "Sök" }));
    expect(await screen.findByRole("button", { name: "Söker..." })).toBeDisabled();
  });

  it("ett fel i jävskontrollen visas", async () => {
    check = () => { throw new Error("Servern svarar inte"); };
    await renderLoaded();
    fireEvent.change(searchBox(), { target: { value: "Anna" } });
    fireEvent.click(screen.getByRole("button", { name: "Sök" }));
    expect(await screen.findByText("Servern svarar inte")).toBeInTheDocument();
  });
});

describe("Ärendelistan — Sök i Mitt aktskåp (#1968)", () => {
  it("Sök kör jävskontrollen mot hela byrån och visar Träff, också för ärenden utanför fliken", async () => {
    flik = null;
    listMatters = [row("1")];
    conflictMatters = [row("3", { status: "CLOSED", title: "Stängt ärende" })];
    check = () => ({
      searchTerm: "Anna",
      matchCount: 1,
      results: [{ matterId: "3", contactName: "Anna Andersson", role: "MOTPART", personalNumber: null, orgNumber: null }],
    });
    const fake = await renderLoaded();
    expect(callsTo(fake, "matter.list")).toContainEqual(expect.objectContaining({ mine: true, status: "ACTIVE" }));
    await search("Anna");
    expect(checks(fake)).toEqual([{ searchTerm: "Anna", searchType: "both" }]);
    await screen.findByText("Stängt ärende");
    expect(within(bodyRow(0)).getByText("Stängt ärende")).toBeInTheDocument();
  });
});
