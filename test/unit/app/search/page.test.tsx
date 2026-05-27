/**
 * Test för DocumentSearchPage.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DocumentSearchPage from "@/app/search/page";

const searchQuery = {
  data: undefined as { hits: unknown[]; totalHits: number } | undefined,
  isFetching: false,
  error: null as Error | null,
};

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    document: {
      search: { useQuery: () => searchQuery },
      // dokumenttyp-facetterna (tillagda denna session)
      listDocumentTypes: { useQuery: () => ({ data: [] }) },
    },
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
