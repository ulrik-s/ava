/**
 * Test för DocumentSearchPage.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import DocumentSearchPage from "@/app/search/page";

const searchQuery = {
  data: undefined as { hits: unknown[]; totalHits: number } | undefined,
  isFetching: false,
  error: null as Error | null,
};

// Omfångsvalet (server/lokal) testas i use-document-search.test.tsx.
vi.mock("@/lib/client/search/use-document-search", () => ({ useDocumentSearch: () => searchQuery }));

let docTypes: Array<{ type: string; count: number }> = [];

vi.mock("@/lib/client/trpc", () => ({
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
  searchQuery.data = undefined;
  searchQuery.isFetching = false;
  searchQuery.error = null;
});

describe("DocumentSearchPage", () => {
  it("renderar Dokumentsökning-rubrik och sökruta", () => {
    render(<DocumentSearchPage />);
    expect(screen.getByRole("heading", { name: /Dokumentsökning/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Sök i dokument/i)).toBeInTheDocument();
  });

  it("visar 'Inga träffar' när data har 0 hits", () => {
    searchQuery.data = { hits: [], totalHits: 0 };
    const { container } = render(<DocumentSearchPage />);
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
    const { container } = render(<DocumentSearchPage />);
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
    const { container } = render(<DocumentSearchPage />);
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
    const { container } = render(<DocumentSearchPage />);
    const input = container.querySelector("input[type='text']") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "yrkar" } });
    fireEvent.submit(input.closest("form")!);
    expect(screen.getByText("Stämning, s. 5")).toBeInTheDocument();
  });

  it("#1220: typfiltret visar etiketter, inte koder", () => {
    docTypes = [{ type: "FUP", count: 2 }, { type: "DELGIVNINGSKVITTO", count: 1 }];
    try {
      render(<DocumentSearchPage />);
      expect(screen.getByText("Delgivningskvitto")).toBeInTheDocument();
      expect(screen.queryByText("DELGIVNINGSKVITTO")).toBeNull();
    } finally {
      docTypes = [];
    }
  });

  it("visar 'Söker...' under fetch", () => {
    searchQuery.isFetching = true;
    render(<DocumentSearchPage />);
    expect(screen.getByRole("button", { name: /Söker/i })).toBeInTheDocument();
  });

  it("visar fel när server returnerar error", () => {
    searchQuery.error = new Error("Meilisearch nere");
    render(<DocumentSearchPage />);
    expect(screen.getByText(/Meilisearch nere/i)).toBeInTheDocument();
  });
});
