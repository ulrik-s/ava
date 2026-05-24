/**
 * Test för MattersPage — listrendering, sökning, filter, ny-form.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MattersPage from "@/app/matters/page";

const mattersQuery: {
  data: { matters: Array<Record<string, unknown>>; total: number; pages: number };
  isLoading: boolean;
} = {
  data: { matters: [], total: 0, pages: 0 },
  isLoading: false,
};
const contactsQuery = { data: { contacts: [] } };
const utilsMock = { matter: { list: { invalidate: vi.fn() } } };
const createMatterMutate = vi.fn();
const searchParamsGet = vi.fn((_: string): string | null => null);

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: searchParamsGet }),
}));

vi.mock("@/client/lib/trpc", () => ({
  trpc: {
    useUtils: () => utilsMock,
    matter: {
      list: { useQuery: () => mattersQuery },
      create: {
        useMutation: () => ({ mutate: createMatterMutate, isPending: false }),
      },
    },
    contacts: {
      list: { useQuery: () => contactsQuery },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  searchParamsGet.mockReturnValue(null);
  mattersQuery.data = { matters: [], total: 0, pages: 0 };
});

describe("MattersPage", () => {
  it("renderar tomtillstånd när inga ärenden finns", () => {
    render(<MattersPage />);
    // Hoppa över Suspense-fallback
    expect(screen.getAllByText(/Ärenden/i).length).toBeGreaterThan(0);
  });

  it("renderar lista med ärenden", () => {
    mattersQuery.data = {
      matters: [
        {
          id: "m1",
          matterNumber: "2026-0001",
          title: "Bodelning Lindström",
          status: "ACTIVE",
          matterType: "Familjerätt",
          contacts: [{ contact: { id: "c1", name: "Anna" } }],
          _count: { documents: 5, timeEntries: 10, contacts: 3 },
        },
      ],
      total: 1,
      pages: 1,
    };
    render(<MattersPage />);
    expect(screen.getByText("Bodelning Lindström")).toBeInTheDocument();
    expect(screen.getByText("2026-0001")).toBeInTheDocument();
  });

  it("öppnar Ny ärende-form vid klick på + Nytt ärende", async () => {
    render(<MattersPage />);
    const newButton = await waitFor(() =>
      screen.getByRole("button", { name: /\+ Nytt ärende|\+ Ny ärende/i }),
    );
    fireEvent.click(newButton);
    // Form-fält syns nu — leta efter form-knappen "Skapa ärende"
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Skapa ärende|Spara/i })).toBeInTheDocument(),
    );
  });

  it("öppnar form direkt när searchParams ?new=1", async () => {
    searchParamsGet.mockImplementation((k: string) => (k === "new" ? "1" : null));
    render(<MattersPage />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Skapa ärende|Spara/i })).toBeInTheDocument(),
    );
  });

  it("submittar Nytt ärende-formulär med titel", async () => {
    render(<MattersPage />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Nytt ärende/i }));
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    fireEvent.change(inputs[0], { target: { value: "Tvist Karlsson" } });
    fireEvent.click(screen.getByRole("button", { name: /Skapa ärende/i }));
    expect(createMatterMutate).toHaveBeenCalled();
    expect(createMatterMutate.mock.calls[0][0].title).toBe("Tvist Karlsson");
  });

  it("ändrar status-filter", () => {
    render(<MattersPage />);
    const filters = screen.getAllByRole("combobox");
    const statusFilter = filters[filters.length - 1] as HTMLSelectElement;
    fireEvent.change(statusFilter, { target: { value: "CLOSED" } });
    expect(statusFilter.value).toBe("CLOSED");
  });

  it("uppdaterar sökfältet", () => {
    render(<MattersPage />);
    const search = screen.getByPlaceholderText(/Sök ärenden/i) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "bodel" } });
    expect(search.value).toBe("bodel");
  });

  it("visar paginering när pages > 1", () => {
    mattersQuery.data = { matters: [], total: 50, pages: 3 };
    render(<MattersPage />);
    expect(screen.getByText(/Sida 1 av 3/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Nästa/i }));
    expect(screen.getByText(/Sida 2 av 3/)).toBeInTheDocument();
  });

  it("renderar Stängt och Arkiverat-statusar i tabellen", () => {
    mattersQuery.data = {
      matters: [
        {
          id: "m1",
          matterNumber: "2026-0001",
          title: "Stängt fall",
          status: "CLOSED",
          matterType: null,
          contacts: [],
          _count: { documents: 0, timeEntries: 0, contacts: 0 },
        },
        {
          id: "m2",
          matterNumber: "2026-0002",
          title: "Gammalt fall",
          status: "ARCHIVED",
          matterType: null,
          contacts: [],
          _count: { documents: 0, timeEntries: 0, contacts: 0 },
        },
      ],
      total: 2,
      pages: 1,
    };
    render(<MattersPage />);
    expect(screen.getByText("Stängt")).toBeInTheDocument();
    expect(screen.getByText("Arkiverat")).toBeInTheDocument();
  });
});
