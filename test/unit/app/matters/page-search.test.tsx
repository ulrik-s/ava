/**
 * Sammanslagen sökning i ärendelistan (#1642): live-filtrering medan man
 * skriver, jävskontroll vid Sök/Enter, en lista med kolumnen "Träff",
 * status för jävsträffarnas rader och jävmärkningen.
 */

import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import MattersPage from "@/app/matters/page";

type Row = Record<string, unknown>;
const row = (id: string, over: Row = {}): Row => ({
  id, matterNumber: `2026-000${id}`, title: `Ärende ${id}`, status: "ACTIVE",
  contacts: [], _count: { contacts: 0 }, ...over,
});

let listMatters: Row[] = [];
let conflictMatters: Row[] = [];
const listQuery = vi.fn((input: { search?: string; ids?: string[] }, _opts?: { enabled?: boolean }) => ({
  data: { matters: input.ids ? conflictMatters : listMatters, total: 0, pages: 1 }, isLoading: false,
}));

const checkMutate = vi.fn();
const checkReset = vi.fn();
const checkState: { data: undefined | { searchTerm: string; matchCount: number; results: Row[] }; isPending: boolean; error: null | { message: string } } = {
  data: undefined, isPending: false, error: null,
};

vi.mock("next/navigation", () => ({ useSearchParams: () => ({ get: () => null }) }));

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ matter: { list: { invalidate: vi.fn() } }, prefs: { get: { invalidate: vi.fn() } } }),
    matter: {
      list: { useQuery: (input: { search?: string; ids?: string[] }, opts?: { enabled?: boolean }) => listQuery(input, opts) },
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    conflict: {
      check: { useMutation: () => ({ mutate: checkMutate, reset: checkReset, ...checkState }) },
    },
    contacts: { search: { useQuery: () => ({ data: { contacts: [] }, isLoading: false }) } },
    organization: { getSettings: { useQuery: () => ({ data: { matterTypes: [] } }) } },
    user: {
      list: { useQuery: () => ({ data: { users: [] } }) },
      current: { useQuery: () => ({ data: { id: "u1", role: "LAWYER" } }) },
    },
    prefs: {
      get: { useQuery: () => ({ data: undefined, isLoading: false }) },
      save: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clear: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      setOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clearOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

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
  vi.clearAllMocks();
  listMatters = [row("1"), row("2")];
  conflictMatters = [];
  checkState.data = undefined;
  checkState.isPending = false;
  checkState.error = null;
});

describe("Ärendelistan — sammanslagen sökning (#1642)", () => {
  it("före sökning: listan som i dag, utan Träff-kolumn och utan jävmärkning", () => {
    render(<MattersPage />);
    expect(columnHeaders().some((h) => h.includes("Träff"))).toBe(false);
    expect(screen.queryByText(/träff\(ar\)|Inga träffar/)).toBeNull();
    expect(screen.getByRole("option", { name: "Alla statusar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sök" })).toBeDisabled();
  });

  it("att skriva filtrerar live utan att köra jävskontrollen", () => {
    render(<MattersPage />);
    fireEvent.change(searchBox(), { target: { value: "anna" } });
    expect(listQuery).toHaveBeenCalledWith(expect.objectContaining({ search: "anna" }), undefined);
    expect(checkMutate).not.toHaveBeenCalled();
    expect(checkReset).toHaveBeenCalled();
  });

  it("Sök kör conflict.check en gång med den trimmade texten (namn + nummer)", () => {
    render(<MattersPage />);
    fireEvent.change(searchBox(), { target: { value: " Anna Andersson " } });
    fireEvent.click(screen.getByRole("button", { name: "Sök" }));
    expect(checkMutate).toHaveBeenCalledTimes(1);
    expect(checkMutate).toHaveBeenCalledWith({ searchTerm: "Anna Andersson", searchType: "both" });
  });

  it("Enter i sökrutan kör conflict.check en gång", () => {
    render(<MattersPage />);
    fireEvent.change(searchBox(), { target: { value: "Anna" } });
    fireEvent.submit(searchBox());
    expect(checkMutate).toHaveBeenCalledTimes(1);
    expect(checkMutate).toHaveBeenCalledWith({ searchTerm: "Anna", searchType: "both" });
  });

  it("bara blanksteg kör ingen jävskontroll", () => {
    render(<MattersPage />);
    fireEvent.change(searchBox(), { target: { value: "   " } });
    fireEvent.submit(searchBox());
    expect(checkMutate).not.toHaveBeenCalled();
  });

  it("efter sökning: jävsträffarnas ärenden överst med status, ett ärende per rad, Träff-kolumnen och märkningen", () => {
    listMatters = [row("1", { title: "Anna mot Bo" }), row("2")];
    conflictMatters = [row("3", { status: "CLOSED", title: "Gammalt ärende" }), row("1", { title: "Anna mot Bo" })];
    checkState.data = {
      searchTerm: "Anna",
      matchCount: 2,
      results: [
        { matterId: "3", contactName: "Anna Andersson", role: "MOTPART", personalNumber: "19800101-1234", orgNumber: null },
        { matterId: "1", contactName: "Anna Andersson", role: "MOTPART", personalNumber: null, orgNumber: null },
      ],
    };
    render(<MattersPage />);
    expect(listQuery).toHaveBeenCalledWith({ ids: ["3", "1"], page: 1, pageSize: 2 }, { enabled: true });
    expect(columnHeaders().some((h) => h.includes("Träff"))).toBe(true);
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

  it("inga jävsträffar: märkningen 'Inga träffar' och listan med Träff-kolumnen; inget id-anrop", () => {
    checkState.data = { searchTerm: "Ärende 2", matchCount: 0, results: [] };
    render(<MattersPage />);
    expect(screen.getByText("Inga träffar")).toBeInTheDocument();
    expect(listQuery).toHaveBeenCalledWith({ ids: [], page: 1, pageSize: 1 }, { enabled: false });
    expect(bodyRows()).toHaveLength(2);
    expect(within(bodyRow(1)).getByText("Titel")).toBeInTheDocument();
  });

  it("rensas sökrutan glöms sökningen (kolumnen och märkningen försvinner)", () => {
    checkState.data = { searchTerm: "Anna", matchCount: 0, results: [] };
    render(<MattersPage />);
    fireEvent.change(searchBox(), { target: { value: "Anna" } });
    fireEvent.change(searchBox(), { target: { value: "" } });
    expect(checkReset).toHaveBeenCalledTimes(2);
    expect(searchBox().value).toBe("");
  });

  it("medan jävskontrollen pågår visar knappen 'Söker...'; ett fel visas", () => {
    checkState.isPending = true;
    checkState.error = { message: "Servern svarar inte" };
    render(<MattersPage />);
    expect(screen.getByRole("button", { name: "Söker..." })).toBeDisabled();
    expect(screen.getByText("Servern svarar inte")).toBeInTheDocument();
  });
});
