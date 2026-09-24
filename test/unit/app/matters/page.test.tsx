/**
 * Test för MattersPage — listrendering, sökning, filter, ny-form.
 */

import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import MattersPage from "@/app/matters/page";

const mattersQuery: {
  data: { matters: Array<Record<string, unknown>>; total: number; pages: number };
  isLoading: boolean;
} = {
  data: { matters: [], total: 0, pages: 0 },
  isLoading: false,
};
const contactsQuery = { data: { contacts: [] } };
const employeesQuery = { data: { users: [] } };
const utilsMock = {
  matter: { list: { invalidate: vi.fn() } },
  contacts: { list: { invalidate: vi.fn() }, search: { invalidate: vi.fn() } },
  prefs: { get: { invalidate: vi.fn() } },
};
const createContactMutate = vi.fn();
/** Klientsökets svar (#1128) — sätts per test. */
let searchHits: Array<{ id: string; name: string; contactType: string; personalNumber?: string | null }> = [];
const searchQuery = vi.fn((input: { term: string }) => ({ data: { contacts: input.term ? searchHits : [] }, isLoading: false }));
/** onSuccess från contacts.create — testet anropar den som servern hade gjort. */
let contactCreated: ((c: { id: string; name: string }) => void) | undefined;
const createMatterMutate = vi.fn();
const searchParamsGet = vi.fn((_: string): string | null => null);

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: searchParamsGet }),
}));

vi.mock("@/lib/client/trpc", () => ({
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
      search: { useQuery: (input: { term: string }) => searchQuery(input) },
      create: {
        useMutation: (opts?: { onSuccess?: (c: { id: string; name: string }) => void }) => {
          contactCreated = opts?.onSuccess;
          return { mutate: createContactMutate, isPending: false, error: null };
        },
      },
    },
    user: {
      list: { useQuery: () => employeesQuery },
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
    fireEvent.change(inputs[0]!, { target: { value: "Tvist Karlsson" } });
    fireEvent.click(screen.getByRole("button", { name: /Skapa ärende/i }));
    expect(createMatterMutate).toHaveBeenCalled();
    expect(createMatterMutate.mock.calls[0]![0].title).toBe("Tvist Karlsson");
  });

  it("ändrar status-filter", () => {
    render(<MattersPage />);
    // Det finns två filter-comboboxar (status + medarbetare) — välj status
    // robust via dess "Alla statusar"-option (inte position).
    const statusFilter = screen.getAllByRole("combobox").find(
      (el) => within(el).queryByRole("option", { name: "Alla statusar" }) !== null,
    ) as HTMLSelectElement;
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

  it("fyller alla fält i Nytt ärende-formuläret → create med komplett payload", () => {
    render(<MattersPage />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Nytt ärende/i }));
    fireEvent.change(screen.getByLabelText(/Titel/), { target: { value: "Tvist AB" } });
    fireEvent.change(screen.getByLabelText("Ärendetyp"), { target: { value: "Brottmål" } });
    fireEvent.change(screen.getByLabelText("Beskrivning"), { target: { value: "Misshandel" } });
    fireEvent.click(screen.getByRole("checkbox")); // Taxeärende
    fireEvent.click(screen.getByRole("button", { name: /Skapa ärende/i }));
    // Målnummer sätts INTE vid uppläggning (#796) — det fylls i senare.
    expect(createMatterMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Tvist AB", matterType: "Brottmål", description: "Misshandel", isTaxeArende: true,
      }),
    );
    expect(screen.queryByLabelText(/målnummer/)).not.toBeInTheDocument();
  });

  it("paginering: Nästa följt av Föregående går tillbaka till sida 1", () => {
    mattersQuery.data = { matters: [], total: 50, pages: 3 };
    render(<MattersPage />);
    fireEvent.click(screen.getByRole("button", { name: /Nästa/i }));
    expect(screen.getByText(/Sida 2 av 3/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Föregående/i }));
    expect(screen.getByText(/Sida 1 av 3/)).toBeInTheDocument();
  });
});

describe("MattersPage — Välj klient via sökdialog (#1128)", () => {
  beforeEach(() => {
    searchHits = [];
  });

  function openPicker(): void {
    render(<MattersPage />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Nytt ärende/i }));
    fireEvent.click(screen.getByRole("button", { name: /Välj klient/ }));
  }

  it("ingen dropdown längre — 'Välj klient…' öppnar en sökdialog", () => {
    openPicker();
    expect(screen.queryByRole("combobox", { name: /Klient/ })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Välj klient" })).toBeInTheDocument();
  });

  it("söker och väljer en befintlig klient — ärendet skapas med den", () => {
    searchHits = [{ id: "c-anna", name: "Anna Karlsson", contactType: "PERSON", personalNumber: "19800101-1234" }];
    openPicker();
    const dialog = screen.getByRole("dialog", { name: "Välj klient" });
    fireEvent.change(within(dialog).getByRole("searchbox"), { target: { value: "Anna" } });
    expect(searchQuery).toHaveBeenLastCalledWith({ term: "Anna" });
    fireEvent.click(within(dialog).getByRole("button", { name: /Anna Karlsson/ }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Anna Karlsson")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Titel/), { target: { value: "Bodelning" } });
    fireEvent.click(screen.getByRole("button", { name: /Skapa ärende/i }));
    expect(createMatterMutate).toHaveBeenCalledWith(expect.objectContaining({ title: "Bodelning", klientId: "c-anna" }));
  });

  it("hittas inte klienten → 'Ny klient…' med sökordet förifyllt; OK skapar och väljer den", () => {
    openPicker();
    fireEvent.change(within(screen.getByRole("dialog", { name: "Välj klient" })).getByRole("searchbox"), { target: { value: "Nya Klienten AB" } });
    expect(screen.getByText(/Ingen träff/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Ny klient/ }));

    const dialog = screen.getByRole("dialog", { name: "Ny klient" });
    expect((within(dialog).getByLabelText(/Namn/) as HTMLInputElement).value).toBe("Nya Klienten AB");
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    expect(createContactMutate).toHaveBeenCalledWith(expect.objectContaining({ name: "Nya Klienten AB" }));

    act(() => contactCreated?.({ id: "c-new", name: "Nya Klienten AB" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Titel/), { target: { value: "Avtalstvist" } });
    fireEvent.click(screen.getByRole("button", { name: /Skapa ärende/i }));
    expect(createMatterMutate).toHaveBeenCalledWith(expect.objectContaining({ klientId: "c-new" }));
  });

  it("Avbryt i 'Ny klient' skapar inget och går tillbaka till sökningen", () => {
    openPicker();
    fireEvent.click(screen.getByRole("button", { name: /Ny klient/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Ny klient" })).getByRole("button", { name: "Avbryt" }));
    expect(createContactMutate).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Välj klient" })).toBeInTheDocument();
  });

  it("vald klient kan tas bort igen", () => {
    searchHits = [{ id: "c-anna", name: "Anna Karlsson", contactType: "PERSON" }];
    openPicker();
    fireEvent.change(within(screen.getByRole("dialog")).getByRole("searchbox"), { target: { value: "Anna" } });
    fireEvent.click(screen.getByRole("button", { name: /Anna Karlsson/ }));
    fireEvent.click(screen.getByRole("button", { name: "Ta bort vald klient" }));
    expect(screen.getByRole("button", { name: /Välj klient/ })).toBeInTheDocument();
  });
});
