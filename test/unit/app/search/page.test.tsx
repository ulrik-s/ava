/**
 * Test för DocumentSearchPage.
 */

import { screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import DocumentSearchPage from "@/app/search/page";
import { rowOrder, sortColumn } from "../../../helpers/data-table";
import { NEW_TRPC_BINDING, renderWithNewTrpc } from "../../../helpers/trpc-classic-mock";

const searchQuery = {
  data: undefined as
    | { hits: unknown[]; totalHits: number; facets?: { documentTypes?: Array<{ type: string; count: number }> } }
    | undefined,
  isFetching: false,
  error: null as Error | null,
};

// Omfångsvalet (server/lokal) testas i use-document-search.test.tsx.
/** Det sökningen senast fick: termen och typfiltret. */
const searchInput = vi.fn((_input: { query: string; documentTypes?: string[] }) => searchQuery);
vi.mock("@/lib/client/search/use-document-search", () => ({
  useDocumentSearch: (input: { query: string; documentTypes?: string[] }) => searchInput(input),
}));

let docTypes: Array<{ type: string; count: number }> = [];

vi.mock("@/lib/client/trpc", () => ({
  ...NEW_TRPC_BINDING,
  trpc: {
    useUtils: () => ({ prefs: { get: { invalidate: vi.fn() } } }),
    document: {
      listDocumentTypes: { useQuery: () => ({ data: docTypes }) },
    },
    prefs: {
      get: { useQuery: () => ({ data: undefined, isLoading: false }) },
      save: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clear: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      setOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clearOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    user: { current: { useQuery: () => ({ data: { id: "u1", role: "LAWYER" } }) } },
  },
}));

beforeEach(() => {
  docTypes = [];
  searchInput.mockClear();
  searchQuery.data = undefined;
  searchQuery.isFetching = false;
  searchQuery.error = null;
});

describe("DocumentSearchPage", () => {
  it("renderar Dokumentsökning-rubrik och sökruta", () => {
    renderWithNewTrpc(<DocumentSearchPage />);
    expect(screen.getByRole("heading", { name: /Dokumentsökning/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Sök i dokument/i)).toBeInTheDocument();
  });

  it("visar 'Inga träffar' när data har 0 hits", () => {
    searchQuery.data = { hits: [], totalHits: 0 };
    const { container } = renderWithNewTrpc(<DocumentSearchPage />);
    const input = container.querySelector("input[type='text']") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.submit(input.closest("form")!);
    expect(screen.getByText(/Inga träffar/i)).toBeInTheDocument();
  });

  it("visar träffar med filnamn och ärendelänk", () => {
    searchQuery.data = {
      hits: [
        {
          documentId: "d1",
          fileName: "stamning.pdf",
          matterId: "m1",
          matterNumber: "2026-0001",
          matterTitle: "Bodelning",
          highlight: "<em>relevant</em> text",
        },
      ],
      totalHits: 1,
    };
    const { container } = renderWithNewTrpc(<DocumentSearchPage />);
    const input = container.querySelector("input[type='text']") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "stamning" } });
    fireEvent.submit(input.closest("form")!);
    expect(screen.getByText("stamning.pdf")).toBeInTheDocument();
    expect(screen.getByText(/2026-0001/)).toBeInTheDocument();
    expect(screen.queryByText(/^s\. /)).toBeNull();
  });

  it("visar sidnumret för innehållsträffen (#1215)", () => {
    searchQuery.data = {
      hits: [{ documentId: "d1", fileName: "inlaga.pdf", matterId: "m1", matterNumber: "1", matterTitle: "X", highlight: "<mark>stämning</mark>", page: 7 }],
      totalHits: 1,
    };
    const { container } = renderWithNewTrpc(<DocumentSearchPage />);
    const input = container.querySelector("input[type='text']") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "stämning" } });
    fireEvent.submit(input.closest("form")!);
    expect(screen.getByText("s. 7")).toBeInTheDocument();
  });

  it("#1220: träffen visar delen den ligger i — \"Stämning, s. 5\"", () => {
    searchQuery.data = {
      hits: [{ documentId: "d1", fileName: "sammansatt.pdf", matterId: "m1", matterNumber: "1", matterTitle: "X", highlight: "x", page: 5, part: { kind: "STAMNING", fromPage: 3, toPage: 9 } }],
      totalHits: 1,
    };
    const { container } = renderWithNewTrpc(<DocumentSearchPage />);
    const input = container.querySelector("input[type='text']") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "yrkar" } });
    fireEvent.submit(input.closest("form")!);
    expect(screen.getByText("Stämning, s. 5")).toBeInTheDocument();
  });

  it("#1220: typfiltret visar etiketter, inte koder", () => {
    docTypes = [{ type: "FUP", count: 2 }, { type: "DELGIVNINGSKVITTO", count: 1 }];
    try {
      renderWithNewTrpc(<DocumentSearchPage />);
      expect(screen.getByText("Delgivningskvitto")).toBeInTheDocument();
      expect(screen.queryByText("DELGIVNINGSKVITTO")).toBeNull();
    } finally {
      docTypes = [];
    }
  });

  it("visar 'Söker...' under fetch", () => {
    searchQuery.isFetching = true;
    renderWithNewTrpc(<DocumentSearchPage />);
    expect(screen.getByRole("button", { name: /Söker/i })).toBeInTheDocument();
  });

  it("visar fel när server returnerar error", () => {
    searchQuery.error = new Error("Meilisearch nere");
    renderWithNewTrpc(<DocumentSearchPage />);
    expect(screen.getByText(/Meilisearch nere/i)).toBeInTheDocument();
  });
});

// ── Sorteringen och typfiltret (#1904) ──────────────────────────────────

function search(term: string): void {
  const input = screen.getByPlaceholderText(/Sök i dokument/i);
  fireEvent.change(input, { target: { value: term } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
}

const hit = (documentId: string, fileName: string, matterNumber: string): Record<string, unknown> => ({
  documentId, fileName, matterId: `m-${documentId}`, matterNumber, matterTitle: "X", highlight: "x",
});

describe("DocumentSearchPage — kolumnerna sorterar på det som visas (#1904)", () => {
  it("Fil på filnamnet och Ärende på ärendenumret", () => {
    searchQuery.data = {
      hits: [hit("d1", "b.pdf", "2026-0002"), hit("d2", "c.pdf", "2026-0001"), hit("d3", "a.pdf", "2026-0003")],
      totalHits: 3,
    };
    renderWithNewTrpc(<DocumentSearchPage />);
    search("avtal");
    const files = ["a.pdf", "b.pdf", "c.pdf"];
    sortColumn("Fil", "asc");
    expect(rowOrder(files)).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
    sortColumn("Ärende", "asc");
    expect(rowOrder(files)).toEqual(["c.pdf", "b.pdf", "a.pdf"]);
  });
});

describe("DocumentSearchPage — typfiltret (#1904)", () => {
  beforeEach(() => {
    docTypes = [{ type: "FUP", count: 2 }, { type: "STAMNING", count: 5 }];
  });

  const chip = (label: string): HTMLInputElement => {
    const box = screen.getByText(label).closest("label")?.querySelector("input");
    if (!box) throw new Error(`Ingen kryssruta för ${label}`);
    return box;
  };

  it("kryss väljer typen, nytt kryss tar bort den, och Sök skickar valet", () => {
    renderWithNewTrpc(<DocumentSearchPage />);
    expect(screen.getByText("Inga filter — söker i alla typer.")).toBeInTheDocument();
    fireEvent.click(chip("Stämning"));
    fireEvent.click(chip("FUP"));
    expect(screen.getByText(/Filter aktivt: 2 typ\(er\)/)).toBeInTheDocument();
    fireEvent.click(chip("FUP"));
    expect(chip("FUP").checked).toBe(false);
    search("yrkande");
    expect(searchInput).toHaveBeenLastCalledWith({ query: "yrkande", documentTypes: ["STAMNING"] });
  });

  it("Rensa filter tar bort alla valda typer", () => {
    renderWithNewTrpc(<DocumentSearchPage />);
    fireEvent.click(chip("Stämning"));
    fireEvent.click(screen.getByRole("button", { name: "Rensa filter" }));
    expect(chip("Stämning").checked).toBe(false);
    expect(screen.queryByRole("button", { name: "Rensa filter" })).toBeNull();
    search("yrkande");
    expect(searchInput).toHaveBeenLastCalledWith({ query: "yrkande" });
  });

  it("efter sökning visar räknarna träffarna per typ, 0 för typer utan träff", () => {
    searchQuery.data = { hits: [], totalHits: 3, facets: { documentTypes: [{ type: "STAMNING", count: 3 }] } };
    renderWithNewTrpc(<DocumentSearchPage />);
    expect(screen.getByText(/räknarna visar träffar för ""/)).toBeInTheDocument();
    expect(screen.getByText("Stämning").closest("label")).toHaveTextContent("Stämning (3)");
    expect(screen.getByText("FUP").closest("label")).toHaveTextContent("(0)");
  });

  it("efter sökning utan typräkning står alla typer på 0", () => {
    searchQuery.data = { hits: [], totalHits: 0 };
    renderWithNewTrpc(<DocumentSearchPage />);
    expect(screen.getByText("Stämning").closest("label")).toHaveTextContent("Stämning (0)");
  });
});
