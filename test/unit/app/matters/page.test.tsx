/**
 * Test för MattersPage — listrendering, sökning, filter, ny-form.
 */

import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import MattersPage from "@/app/matters/page";
import { ClientPickerDialog } from "@/components/contacts/client-picker-dialog";
import { openColumnMenu, rowOrder, rowWith, sortColumn } from "../../../helpers/data-table";

const mattersQuery: {
  data: { matters: Array<Record<string, unknown>>; total: number; pages: number };
  isLoading: boolean;
} = {
  data: { matters: [], total: 0, pages: 0 },
  isLoading: false,
};
const contactsQuery = { data: { contacts: [] } };
/** Byråns användare (`user.list`) — prefixen styr initialerna i Ärendenr (#1727). */
const employeesQuery: { data: { users: Array<{ id: string; name: string; matterNumberPrefix?: string | null }> } } = {
  data: { users: [] },
};
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
/** onSuccess från matter.create — testet anropar den som servern hade gjort. */
let matterCreated: (() => void) | undefined;
/** Byråns ärendetyper (org-inställning) — tom = fritext. */
let matterTypes: string[] = [];
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
        useMutation: (opts?: { onSuccess?: () => void }) => {
          matterCreated = opts?.onSuccess;
          return { mutate: createMatterMutate, isPending: false };
        },
      },
    },
    // Sammanslagen sökning (#1642) — täcks i page-search.test.tsx.
    conflict: {
      check: { useMutation: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, data: undefined, error: null }) },
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
    organization: {
      getSettings: { useQuery: () => ({ data: { matterTypes } }) },
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
  matterTypes = [];
  employeesQuery.data.users = [];
});

describe("MattersPage", () => {
  it("renderar tomtillstånd när inga ärenden finns", () => {
    render(<MattersPage />);
    // Hoppa över Suspense-fallback
    expect(screen.getAllByText(/Ärenden/i).length).toBeGreaterThan(0);
  });

  it("sidrubriken heter som menyvalet: Ärenden / jävskontroll (#1690)", () => {
    render(<MattersPage />);
    const heading = screen.getByRole("heading", { level: 1, name: "Ärenden / jävskontroll" });
    expect(heading.className).toBe("text-2xl font-bold text-gray-900");
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
          parties: [{ role: "KLIENT", name: "Anna" }],
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
    fireEvent.change(screen.getByLabelText("Titel *"), { target: { value: "Tvist Karlsson" } });
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
    const search = screen.getByPlaceholderText<HTMLInputElement>(/Sök ärenden/i);
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
          parties: [],
          _count: { documents: 0, timeEntries: 0, contacts: 0 },
        },
        {
          id: "m2",
          matterNumber: "2026-0002",
          title: "Gammalt fall",
          status: "ARCHIVED",
          matterType: null,
          contacts: [],
          parties: [],
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

  it("visar ärendetypen som egen kolumn — '—' när typ saknas", () => {
    const row = (id: string, matterType: string | null) => ({
      id, matterNumber: `2026-000${id}`, title: `Fall ${id}`, status: "ACTIVE", matterType,
      contacts: [], parties: [], _count: { documents: 0, timeEntries: 0, contacts: 0 },
    });
    mattersQuery.data = { matters: [row("1", "Bodelning"), row("2", null)], total: 2, pages: 1 };
    render(<MattersPage />);
    expect(screen.getByRole("columnheader", { name: /Ärendetyp/ })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Bodelning" })).toBeInTheDocument();
    expect(screen.getAllByRole("cell", { name: "—" }).length).toBeGreaterThan(0);
  });

  it("Ärendenr visar ansvarig jurists initialer när numret inte bär dem (#1727)", () => {
    employeesQuery.data.users = [{ id: "u-cd", name: "Cecilia D", matterNumberPrefix: "CD" }];
    const row = (id: string, matterNumber: string) => ({
      id, matterNumber, title: `Fall ${id}`, status: "ACTIVE", responsibleLawyerId: "u-cd",
      contacts: [], parties: [], _count: { documents: 0, timeEntries: 0, contacts: 0 },
    });
    mattersQuery.data = { matters: [row("1", "AB2026-0001"), row("2", "CD2026-0002")], total: 2, pages: 1 };
    render(<MattersPage />);
    const other = screen.getByRole("cell", { name: "CD AB2026-0001" });
    expect(within(other).getByText("CD").tagName).toBe("STRONG");
    const own = screen.getByRole("cell", { name: "CD2026-0002" });
    expect(own.querySelector("strong")).toBeNull();
  });

  it("fyller alla fält i Nytt ärende-formuläret → create med komplett payload", () => {
    render(<MattersPage />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Nytt ärende/i }));
    fireEvent.change(screen.getByLabelText(/Titel/), { target: { value: "Tvist AB" } });
    fireEvent.change(screen.getByLabelText("Ärendetyp"), { target: { value: "Brottmål" } });
    fireEvent.change(screen.getByLabelText("Beskrivning"), { target: { value: "Misshandel" } });
    fireEvent.click(screen.getByRole("button", { name: /Skapa ärende/i }));
    expect(createMatterMutate).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Tvist AB", matterType: "Brottmål", description: "Misshandel" }),
    );
    // Taxa/icke-taxa väljs i kostnadsräkningen, inte vid nytt ärende (#1613).
    expect(createMatterMutate.mock.calls[0]?.[0]).not.toHaveProperty("isTaxeArende");
  });

  it("Nytt ärende har ingen Taxeärende-kryssruta (#1613)", () => {
    render(<MattersPage />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Nytt ärende/i }));
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText("Taxeärende")).toBeNull();
    expect(screen.queryByText(/Domstolsverkets fastställda taxa/)).toBeNull();
  });

  it("Målnummer-rutan visas alltid i Nytt ärende, även utan klient (#1509)", () => {
    render(<MattersPage />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Nytt ärende/i }));
    expect(screen.getByLabelText("Målnummer")).toBeInTheDocument();
  });

  it("tom/blank Målnummer-ruta → inget courtCaseNumber skickas (#1509)", () => {
    render(<MattersPage />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Nytt ärende/i }));
    fireEvent.change(screen.getByLabelText(/Titel/), { target: { value: "Tvist AB" } });
    fireEvent.change(screen.getByLabelText("Målnummer"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /Skapa ärende/i }));
    expect(createMatterMutate.mock.calls[0]?.[0].courtCaseNumber).toBeUndefined();
  });

  it("ifyllt Målnummer skickas trimmat som courtCaseNumber (#1509)", () => {
    render(<MattersPage />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Nytt ärende/i }));
    fireEvent.change(screen.getByLabelText(/Titel/), { target: { value: "Tvist AB" } });
    fireEvent.change(screen.getByLabelText("Målnummer"), { target: { value: "  B 1234-26 " } });
    fireEvent.click(screen.getByRole("button", { name: /Skapa ärende/i }));
    expect(createMatterMutate).toHaveBeenCalledWith(expect.objectContaining({ courtCaseNumber: "B 1234-26" }));
  });

  it("byrån saknar ärendetyper → Ärendetyp är en fritext-ruta", () => {
    render(<MattersPage />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Nytt ärende/i }));
    const input = screen.getByLabelText("Ärendetyp");
    expect(input.tagName).toBe("INPUT");
    fireEvent.change(screen.getByLabelText(/Titel/), { target: { value: "Dödsbo" } });
    fireEvent.change(input, { target: { value: "Egen typ" } });
    fireEvent.click(screen.getByRole("button", { name: /Skapa ärende/i }));
    expect(createMatterMutate).toHaveBeenCalledWith(expect.objectContaining({ matterType: "Egen typ" }));
  });

  it("byrån har ärendetyper → Ärendetyp väljs ur listan", () => {
    matterTypes = ["Bodelning", "God man"];
    render(<MattersPage />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Nytt ärende/i }));
    const select = screen.getByLabelText("Ärendetyp");
    expect(select.tagName).toBe("SELECT");
    expect(screen.getByRole("option", { name: "God man" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Titel/), { target: { value: "Dödsbo" } });
    fireEvent.change(select, { target: { value: "God man" } });
    fireEvent.click(screen.getByRole("button", { name: /Skapa ärende/i }));
    expect(createMatterMutate).toHaveBeenCalledWith(expect.objectContaining({ matterType: "God man" }));
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
    expect((within(dialog).getByLabelText<HTMLInputElement>(/Namn/)).value).toBe("Nya Klienten AB");
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

describe("ClientPickerDialog — startvärde för sökrutan (#1644)", () => {
  beforeEach(() => {
    searchHits = [{ id: "c-anna", name: "Anna Karlsson", contactType: "PERSON" }];
  });

  it("med initialTerm är sökrutan ifylld och träffarna visas direkt", () => {
    render(<ClientPickerDialog initialTerm="Anna" onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole<HTMLInputElement>("searchbox").value).toBe("Anna");
    expect(searchQuery).toHaveBeenLastCalledWith({ term: "Anna" });
    expect(screen.getByRole("button", { name: /Anna Karlsson/ })).toBeInTheDocument();
  });

  it("utan initialTerm är sökrutan tom som förut", () => {
    render(<ClientPickerDialog onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole<HTMLInputElement>("searchbox").value).toBe("");
    expect(screen.getByText("Skriv för att söka.")).toBeInTheDocument();
  });

  it("'+ Ny klient…' får startvärdet som namn", () => {
    render(<ClientPickerDialog initialTerm="Nya Klienten AB" onPick={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Ny klient/ }));
    const dialog = screen.getByRole("dialog", { name: "Ny klient" });
    expect(within(dialog).getByLabelText<HTMLInputElement>(/Namn/).value).toBe("Nya Klienten AB");
  });
});

describe("MattersPage — titel och klient fyller i varandra (#1644)", () => {
  beforeEach(() => {
    searchHits = [{ id: "c-anna", name: "Anna Karlsson", contactType: "PERSON" }];
  });

  function openForm(): void {
    render(<MattersPage />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Nytt ärende/i }));
  }

  function titleInput(): HTMLInputElement {
    return screen.getByLabelText<HTMLInputElement>(/Titel/);
  }

  it("titel → sökrutan är ifylld med den trimmade titeln", () => {
    openForm();
    fireEvent.change(titleInput(), { target: { value: "  Anna Karlsson  " } });
    fireEvent.click(screen.getByRole("button", { name: /Välj klient/ }));
    const dialog = screen.getByRole("dialog", { name: "Välj klient" });
    expect(within(dialog).getByRole<HTMLInputElement>("searchbox").value).toBe("Anna Karlsson");
    expect(within(dialog).getByRole("button", { name: /Anna Karlsson/ })).toBeInTheDocument();
  });

  it("tom titel (bara mellanslag) → tom sökruta", () => {
    openForm();
    fireEvent.change(titleInput(), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /Välj klient/ }));
    expect(within(screen.getByRole("dialog")).getByRole<HTMLInputElement>("searchbox").value).toBe("");
  });

  it("klient vald med tom titel → titeln får klientens namn", () => {
    openForm();
    fireEvent.click(screen.getByRole("button", { name: /Välj klient/ }));
    fireEvent.change(within(screen.getByRole("dialog")).getByRole("searchbox"), { target: { value: "Anna" } });
    fireEvent.click(screen.getByRole("button", { name: /Anna Karlsson/ }));
    expect(titleInput().value).toBe("Anna Karlsson");
    fireEvent.click(screen.getByRole("button", { name: /Skapa ärende/i }));
    expect(createMatterMutate).toHaveBeenCalledWith(expect.objectContaining({ title: "Anna Karlsson", klientId: "c-anna" }));
  });

  it("nyskapad klient med tom titel → titeln får klientens namn", () => {
    openForm();
    fireEvent.click(screen.getByRole("button", { name: /Välj klient/ }));
    fireEvent.click(screen.getByRole("button", { name: /Ny klient/ }));
    act(() => contactCreated?.({ id: "c-new", name: "Nya Klienten AB" }));
    expect(titleInput().value).toBe("Nya Klienten AB");
  });

  it("ifylld titel rörs inte när klienten väljs", () => {
    openForm();
    fireEvent.change(titleInput(), { target: { value: "Bodelning" } });
    fireEvent.click(screen.getByRole("button", { name: /Välj klient/ }));
    fireEvent.change(within(screen.getByRole("dialog")).getByRole("searchbox"), { target: { value: "Anna" } });
    fireEvent.click(screen.getByRole("button", { name: /Anna Karlsson/ }));
    expect(titleInput().value).toBe("Bodelning");
  });
});

// ── Kolumnerna, täckningen och formulärets händelser (#1903) ─────────────

/** Fyra ärenden där varje kolumn ger en egen ordning. */
const sortableMatters = (): Array<Record<string, unknown>> => [
  { id: "a", matterNumber: "2026-0009", title: "Alfa", status: "CLOSED", matterType: "Familjerätt", isTaxeArende: true,
    contacts: [{ contact: { name: "Örjan" } }], parties: [], _count: { contacts: 1 },
    paymentMethod: "RATTSHJALP", rattshjalpMaxTimmar: 100, coverageUsage: { billableMinutes: 95 * 60, billableValueOre: 0 } },
  { id: "b", matterNumber: "AB2026-0001", title: "Beta", status: "ACTIVE", matterType: null,
    contacts: [], parties: [], _count: { contacts: 4 },
    paymentMethod: "RATTSSKYDD", rattsskyddMaxOre: 100_000, coverageUsage: { billableMinutes: 0, billableValueOre: 150_000 } },
  { id: "c", matterNumber: "2026-0010", title: "Gamma", status: "ARCHIVED", matterType: "Arv",
    contacts: [{ contact: { name: "Anna" } }], parties: [], _count: { contacts: 2 },
    paymentMethod: "RATTSHJALP", coverageUsage: { billableMinutes: 600, billableValueOre: 0 } },
  { id: "d", matterNumber: "XYZ-1", title: "Delta", status: "ACTIVE", matterType: "Brott",
    contacts: [{ contact: { name: "Bo" } }], parties: [], _count: { contacts: 0 } },
];

describe("MattersPage — kolumner och täckning (#1903)", () => {
  beforeEach(() => {
    mattersQuery.data = { matters: sortableMatters(), total: 4, pages: 1 };
  });

  it("varje kolumn sorterar på det som visas", () => {
    render(<MattersPage />);
    sortColumn("Ärendenr", "asc");
    expect(rowOrder(["Alfa", "Beta", "Gamma", "Delta"])).toEqual(["Alfa", "Gamma", "Beta", "Delta"]);
    sortColumn("Titel", "desc");
    expect(rowOrder(["Alfa", "Beta", "Gamma", "Delta"])).toEqual(["Gamma", "Delta", "Beta", "Alfa"]);
    sortColumn("Ärendetyp", "asc");
    expect(rowOrder(["Alfa", "Gamma", "Delta"])).toEqual(["Gamma", "Delta", "Alfa"]);
    sortColumn("Klient", "desc");
    expect(rowOrder(["Alfa", "Gamma", "Delta"])).toEqual(["Alfa", "Delta", "Gamma"]);
    sortColumn("Status", "asc");
    expect(rowOrder(["Alfa", "Beta", "Gamma"])).toEqual(["Beta", "Gamma", "Alfa"]);
    sortColumn("Parter", "desc");
    expect(rowOrder(["Alfa", "Beta", "Gamma", "Delta"])).toEqual(["Beta", "Gamma", "Alfa", "Delta"]);
    sortColumn("Täckning (tak)", "desc");
    expect(rowOrder(["Alfa", "Beta", "Gamma", "Delta"])).toEqual(["Beta", "Alfa", "Gamma", "Delta"]);
  });

  it("Täckning visar procent med varning nära och över taket, '—' utan tak; taxeflaggan ensam märks inte Taxa", () => {
    render(<MattersPage />);
    expect(screen.getByTitle("Över tak")).toHaveTextContent("⚠ 150 %");
    expect(screen.getByTitle("Över tak").className).toContain("text-red-700");
    expect(screen.getByTitle("Närmar sig tak")).toHaveTextContent("⚠ 95 %");
    expect(screen.getByTitle("Närmar sig tak").className).toContain("text-amber-800");
    expect(screen.getByTitle("Inom tak")).toHaveTextContent("10 %");
    expect(screen.getByTitle("Inom tak").className).toContain("text-gray-600");
    expect(within(rowWith("Delta")).getAllByText("—").length).toBeGreaterThan(0);
    // Rättshjälp med kvarglömd taxeflagga är inget taxeärende (#1971).
    expect(within(rowWith("Alfa")).queryByText("Taxa")).toBeNull();
    expect(within(rowWith("Beta")).queryByText("Taxa")).toBeNull();
  });

  it("märket Taxa följer isTaxeMatter: offentligt uppdrag och taxeflaggan (#1971)", () => {
    const row = (id: string, title: string, paymentMethod: string, isTaxeArende: boolean) => ({
      id, matterNumber: `2026-00${id}`, title, status: "ACTIVE", matterType: null, isTaxeArende, paymentMethod,
      contacts: [], parties: [], _count: { contacts: 0 },
    });
    mattersQuery.data = {
      matters: [row("11", "Privat", "PRIVAT", true), row("12", "Offentligt", "OFFENTLIGT_UPPDRAG", true), row("13", "Utan", "OFFENTLIGT_UPPDRAG", false)],
      total: 3, pages: 1,
    };
    render(<MattersPage />);
    expect(within(rowWith("Privat")).queryByTitle(/^Taxeärende/)).toBeNull();
    expect(within(rowWith("Offentligt")).getByTitle(/^Taxeärende/)).toHaveTextContent("Taxa");
    expect(within(rowWith("Utan")).queryByTitle(/^Taxeärende/)).toBeNull();
  });

  it("filter på Täckning väljer på etiketten", () => {
    render(<MattersPage />);
    openColumnMenu("Täckning (tak)");
    fireEvent.change(screen.getByPlaceholderText("Skriv för att filtrera…"), { target: { value: "över" } });
    fireEvent.click(screen.getByRole("button", { name: "Tillämpa" }));
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.queryByText("Alfa")).toBeNull();
    expect(screen.queryByText("Delta")).toBeNull();
  });
});

describe("MattersPage — formulärets händelser (#1903)", () => {
  it("när ärendet skapats stängs formuläret och listan laddas om", () => {
    render(<MattersPage />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Nytt ärende/i }));
    fireEvent.change(screen.getByLabelText("Titel *"), { target: { value: "Tvist" } });
    fireEvent.click(screen.getByRole("button", { name: /Skapa ärende/i }));
    act(() => matterCreated?.());
    expect(utilsMock.matter.list.invalidate).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Skapa ärende/i })).toBeNull();
  });

  it("ansvarig jurist väljs ur byråns användare och skickas med", () => {
    employeesQuery.data.users = [{ id: "u2", name: "Eva Ek" }];
    render(<MattersPage />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Nytt ärende/i }));
    fireEvent.change(screen.getByLabelText("Titel *"), { target: { value: "Tvist" } });
    fireEvent.change(screen.getByLabelText("Ansvarig advokat/jurist"), { target: { value: "u2" } });
    fireEvent.click(screen.getByRole("button", { name: /Skapa ärende/i }));
    expect(createMatterMutate).toHaveBeenCalledWith(expect.objectContaining({ responsibleLawyerId: "u2" }));
  });

  it("medarbetarfiltret skickar vald medarbetare till listan", () => {
    employeesQuery.data.users = [{ id: "u2", name: "Eva Ek" }];
    render(<MattersPage />);
    const filter = screen.getAllByRole("combobox").find(
      (el) => within(el).queryByRole("option", { name: "Alla medarbetare" }) !== null,
    ) as HTMLSelectElement;
    fireEvent.change(filter, { target: { value: "u2" } });
    expect(filter.value).toBe("u2");
  });

  it("klientdialogen stängs med Avbryt utan att välja klient", () => {
    render(<MattersPage />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Nytt ärende/i }));
    fireEvent.click(screen.getByRole("button", { name: /Välj klient/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Avbryt" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /Välj klient/ })).toBeInTheDocument();
  });
});
