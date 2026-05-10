/**
 * Test för ConflictsPage — javskontroll-formulär och historikvisning.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ConflictsPage from "@/app/conflicts/page";

const checkMutate = vi.fn();
const checkState = {
  isPending: false,
  data: undefined as undefined | Record<string, unknown>,
  error: null as null | { message: string },
};
const historyQuery: {
  data: { checks: Array<Record<string, unknown>>; total: number; pages: number };
  isLoading: boolean;
} = { data: { checks: [], total: 0, pages: 0 }, isLoading: false };

vi.mock("@/lib/trpc", () => ({
  trpc: {
    conflict: {
      check: {
        useMutation: () => ({
          mutate: checkMutate,
          isPending: checkState.isPending,
          data: checkState.data,
          error: checkState.error,
        }),
      },
      history: { useQuery: () => historyQuery },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  historyQuery.data = { checks: [], total: 0, pages: 0 };
  checkState.isPending = false;
  checkState.data = undefined;
  checkState.error = null;
});

describe("ConflictsPage", () => {
  it("renderar Jävskontroll-rubrik och sökformulär", () => {
    render(<ConflictsPage />);
    expect(screen.getByRole("heading", { name: /Jävskontroll/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Namn, personnummer/i)).toBeInTheDocument();
  });

  it("kallar conflict.check vid submit med trimmad sökterm", () => {
    render(<ConflictsPage />);
    const input = screen.getByPlaceholderText(/Namn, personnummer/i);
    fireEvent.change(input, { target: { value: "  Anna  " } });
    fireEvent.submit(input.closest("form")!);
    expect(checkMutate).toHaveBeenCalledWith({
      searchTerm: "Anna",
      searchType: "both",
    });
  });

  it("ignorerar tom sökterm", () => {
    render(<ConflictsPage />);
    const input = screen.getByPlaceholderText(/Namn, personnummer/i);
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form")!);
    expect(checkMutate).not.toHaveBeenCalled();
  });

  it("växlar mellan name/personalNumber/both via select", () => {
    render(<ConflictsPage />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "name" } });
    expect(select.value).toBe("name");
  });

  it("renderar resultatet med träffar i tabell", () => {
    checkState.data = {
      searchTerm: "Anna",
      matchCount: 1,
      results: [
        {
          contactId: "c1",
          contactName: "Anna Andersson",
          contactType: "PERSON",
          personalNumber: "19800101-1234",
          orgNumber: null,
          matterId: "m1",
          matterNumber: "2026-0001",
          matterTitle: "Bodelning",
          role: "MOTPART",
          klient: "Karl",
        },
      ],
    };
    render(<ConflictsPage />);
    expect(screen.getByText(/Resultat för/i)).toBeInTheDocument();
    expect(screen.getByText("Anna Andersson")).toBeInTheDocument();
    expect(screen.getByText(/19800101-1234/)).toBeInTheDocument();
    expect(screen.getByText(/2026-0001 — Bodelning/)).toBeInTheDocument();
  });

  it("renderar 'Inga träffar' när matchCount=0", () => {
    checkState.data = { searchTerm: "X", matchCount: 0, results: [] };
    render(<ConflictsPage />);
    expect(screen.getByText(/Inga träffar/)).toBeInTheDocument();
  });

  it("visar fel från check.error", () => {
    checkState.error = { message: "Server-fel" };
    render(<ConflictsPage />);
    expect(screen.getByText("Server-fel")).toBeInTheDocument();
  });

  it("renderar historik-checks", () => {
    historyQuery.data = {
      checks: [
        {
          id: "h1",
          searchTerm: "Anna",
          searchType: "both",
          checkedBy: { name: "Lisa" },
          createdAt: new Date("2026-04-01"),
          results: [{ contactId: "c1" }],
        },
        {
          id: "h2",
          searchTerm: "Bertil",
          searchType: "name",
          checkedBy: { name: "Lisa" },
          createdAt: new Date("2026-04-02"),
          results: [],
        },
      ],
      total: 2,
      pages: 1,
    };
    render(<ConflictsPage />);
    expect(screen.getAllByText(/Anna/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Bertil/).length).toBeGreaterThan(0);
    expect(screen.getByText(/1 träff\(ar\)/)).toBeInTheDocument();
    expect(screen.getByText(/Ingen träff/)).toBeInTheDocument();
  });

  it("visar disabled-läge när isPending", () => {
    checkState.isPending = true;
    render(<ConflictsPage />);
    const submitBtn = screen.getByRole("button", { name: /Söker/i }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });
});
