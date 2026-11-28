/**
 * Test för MattersPage — listrendering, sökning, filter, ny-form.
 */

import type { QueryClient } from "@tanstack/react-query";
import { act, screen, fireEvent, waitFor, within, type RenderResult } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import MattersPage from "@/app/matters/page";
import { ClientPickerDialog } from "@/components/contacts/client-picker-dialog";
import { openColumnMenu, rowOrder, rowWith, sortColumn } from "../../../helpers/data-table";
import { callsTo, DATA_TABLE_HANDLERS, renderWithFakeTrpc } from "../../../helpers/trpc-both-fake";
import { invalidatedPaths, type FakeTrpcLink, type InvalidateSpy } from "../../../helpers/trpc-fake";

/** `matter.list`-svaret för listan (inte jävsträffarnas `ids`-anrop). */
let mattersData: { matters: Array<Record<string, unknown>>; total: number; pages: number } = { matters: [], total: 0, pages: 0 };
/** Byråns användare (`user.list`) — prefixen styr initialerna i Ärendenr (#1727). */
let employees: Array<{ id: string; name: string; matterNumberPrefix?: string | null }> = [];
/** Klientsökets svar (#1128) — sätts per test. */
let searchHits: Array<{ id: string; name: string; contactType: string; personalNumber?: string | null }> = [];
/** Byråns ärendetyper (org-inställning) — tom = fritext. */
let matterTypes: string[] = [];
const searchParamsGet = vi.fn((_: string): string | null => null);
const routerReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: searchParamsGet }),
  useRouter: () => ({ replace: routerReplace }),
}));

/** Adressen `?flik=alla`: Alla ärenden på byrån (#1968). */
function onAllTab(): void {
  searchParamsGet.mockImplementation((k: string) => (k === "flik" ? "alla" : null));
}

/** Den senaste renderingens länk, spion och QueryClient. */
let fake: FakeTrpcLink;
let invalidate: InvalidateSpy;
let queryClient: QueryClient;

function termOf(input: unknown): string {
  return typeof input === "object" && input !== null && "term" in input ? String(input.term) : "";
}

/** Renderar `ui` under en fejkad tRPC-länk som svarar ur testets värden. */
function renderTrpc(ui: React.ReactElement): RenderResult {
  const view = renderWithFakeTrpc(ui, {
    "matter.list": () => mattersData,
    "matter.create": (input) => ({ id: "m-ny", ...Object(input) }),
    "contacts.search": (input) => ({ contacts: termOf(input) ? searchHits : [] }),
    "contacts.create": (input) => ({ id: "c-new", ...Object(input) }),
    "organization.getSettings": () => ({ matterTypes }),
    "user.list": () => ({ users: employees }),
    ...DATA_TABLE_HANDLERS,
  });
  ({ fake, invalidate, queryClient } = view);
  return view;
}

/** Låter länkens svar och React Querys notiser landa. */
async function settle(): Promise<void> {
  await act(async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0)); });
}

/** Renderar sidan och väntar tills frågorna svarat. */
async function renderPage(): Promise<RenderResult> {
  const view = renderTrpc(<MattersPage />);
  await settle();
  return view;
}

/** Byter adress (fliken) och renderar om. */
async function rerenderPage(view: RenderResult): Promise<void> {
  view.rerender(<MattersPage />);
  await settle();
}

type Input = Record<string, unknown>;
const asInput = (v: unknown): Input => (typeof v === "object" && v !== null ? { ...v } : {});
/** `matter.list`-anropen för listan — inte jävsträffarnas `ids`-anrop. */
const listInputs = (): Input[] => callsTo(fake, "matter.list").map(asInput).filter((i) => !("ids" in i));
/** Senaste `matter.list`-anropet för listan. */
function lastListInput(): Input {
  const input = listInputs().at(-1);
  if (!input) throw new Error("matter.list anropades inte");
  return input;
}
/** `staleTime` som listfrågan med `mine` fick (ur cachen, inte länken). */
function listStaleTime(match: { mine: true | undefined }): unknown {
  const query = queryClient.getQueryCache().getAll().find((q) => {
    const [path, meta] = q.queryKey;
    const input = asInput(asInput(meta).input);
    return Array.isArray(path) && path.join(".") === "matter.list" && !("ids" in input) && input.mine === match.mine;
  });
  if (!query) throw new Error("listfrågan saknas i cachen");
  return asInput(query.options).staleTime;
}
/** `matter.create`-anropen. */
const created = (): Input[] => callsTo(fake, "matter.create").map(asInput);
/** Skapa ärende och vänta på anropet. */
async function submit(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: /Skapa ärende/i }));
  await settle();
}
/** Det enda `matter.create`-anropet. */
function createdOnce(): Input {
  expect(created()).toHaveLength(1);
  return created()[0] ?? {};
}

beforeEach(() => {
  vi.clearAllMocks();
  searchParamsGet.mockReturnValue(null);
  mattersData = { matters: [], total: 0, pages: 0 };
  matterTypes = [];
  employees = [];
});

describe("MattersPage", () => {
  it("renderar tomtillstånd när inga ärenden finns", async () => {
    await renderPage();
    // Hoppa över Suspense-fallback
    expect(screen.getAllByText(/Ärenden/i).length).toBeGreaterThan(0);
  });

  it("sidrubriken heter som menyvalet: Ärenden / jävskontroll (#1690)", async () => {
    await renderPage();
    const heading = screen.getByRole("heading", { level: 1, name: "Ärenden / jävskontroll" });
    expect(heading.className).toBe("text-2xl font-bold text-gray-900");
  });

  it("renderar lista med ärenden", async () => {
    mattersData = {
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
    await renderPage();
    expect(screen.getByText("Bodelning Lindström")).toBeInTheDocument();
    expect(screen.getByText("2026-0001")).toBeInTheDocument();
  });

  it("öppnar Ny ärende-form vid klick på + Nytt ärende", async () => {
    await renderPage();
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
    await renderPage();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Skapa ärende|Spara/i })).toBeInTheDocument(),
    );
  });

  it("submittar Nytt ärende-formulär med titel", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /\+ Nytt ärende/i }));
    fireEvent.change(screen.getByLabelText("Titel *"), { target: { value: "Tvist Karlsson" } });
    await submit();
    expect(createdOnce().title).toBe("Tvist Karlsson");
  });

  it("ändrar status-filter", async () => {
    onAllTab();
    await renderPage();
    // Det finns två filter-comboboxar (status + medarbetare) — välj status
    // robust via dess "Alla statusar"-option (inte position).
    const statusFilter = screen.getAllByRole("combobox").find(
      (el) => within(el).queryByRole("option", { name: "Alla statusar" }) !== null,
    ) as HTMLSelectElement;
    fireEvent.change(statusFilter, { target: { value: "CLOSED" } });
    expect(statusFilter.value).toBe("CLOSED");
  });

  it("uppdaterar sökfältet", async () => {
    await renderPage();
    const search = screen.getByPlaceholderText<HTMLInputElement>(/Sök ärenden/i);
    fireEvent.change(search, { target: { value: "bodel" } });
    expect(search.value).toBe("bodel");
  });

  it("sökrutan har vit bakgrund, valrutorna bredvid ändras inte (#1963)", async () => {
    onAllTab();
    await renderPage();
    expect(screen.getByPlaceholderText(/Sök ärenden/i)).toHaveClass("bg-white");
    const filters = screen.getAllByRole("combobox").filter((el) =>
      within(el).queryByRole("option", { name: /Alla statusar|Alla medarbetare/ }) !== null);
    expect(filters).toHaveLength(2);
    for (const el of filters) expect(el).not.toHaveClass("bg-white");
  });

  it("visar paginering när pages > 1", async () => {
    mattersData = { matters: [], total: 50, pages: 3 };
    await renderPage();
    expect(screen.getByText(/Sida 1 av 3/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Nästa/i }));
    await settle();
    expect(screen.getByText(/Sida 2 av 3/)).toBeInTheDocument();
  });

  it("renderar Stängt och Arkiverat-statusar i tabellen", async () => {
    mattersData = {
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
    await renderPage();
    expect(screen.getByText("Stängt")).toBeInTheDocument();
    expect(screen.getByText("Arkiverat")).toBeInTheDocument();
  });

  it("visar ärendetypen som egen kolumn — '—' när typ saknas", async () => {
    const row = (id: string, matterType: string | null) => ({
      id, matterNumber: `2026-000${id}`, title: `Fall ${id}`, status: "ACTIVE", matterType,
      contacts: [], parties: [], _count: { documents: 0, timeEntries: 0, contacts: 0 },
    });
    mattersData = { matters: [row("1", "Bodelning"), row("2", null)], total: 2, pages: 1 };
    await renderPage();
    expect(screen.getByRole("columnheader", { name: /Ärendetyp/ })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Bodelning" })).toBeInTheDocument();
    expect(screen.getAllByRole("cell", { name: "—" }).length).toBeGreaterThan(0);
  });

  it("Ärendenr visar ansvarig jurists initialer när numret inte bär dem (#1727)", async () => {
    employees = [{ id: "u-cd", name: "Cecilia D", matterNumberPrefix: "CD" }];
    const row = (id: string, matterNumber: string) => ({
      id, matterNumber, title: `Fall ${id}`, status: "ACTIVE", responsibleLawyerId: "u-cd",
      contacts: [], parties: [], _count: { documents: 0, timeEntries: 0, contacts: 0 },
    });
    mattersData = { matters: [row("1", "AB2026-0001"), row("2", "CD2026-0002")], total: 2, pages: 1 };
    await renderPage();
    const other = screen.getByRole("cell", { name: "CD AB2026-0001" });
    expect(within(other).getByText("CD").tagName).toBe("STRONG");
    const own = screen.getByRole("cell", { name: "CD2026-0002" });
    expect(own.querySelector("strong")).toBeNull();
  });

  it("fyller alla fält i Nytt ärende-formuläret → create med komplett payload", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /\+ Nytt ärende/i }));
    fireEvent.change(screen.getByLabelText(/Titel/), { target: { value: "Tvist AB" } });
    fireEvent.change(screen.getByLabelText("Ärendetyp"), { target: { value: "Brottmål" } });
    fireEvent.change(screen.getByLabelText("Beskrivning"), { target: { value: "Misshandel" } });
    await submit();
    expect(createdOnce()).toEqual(
      expect.objectContaining({ title: "Tvist AB", matterType: "Brottmål", description: "Misshandel" }),
    );
    // Taxa/icke-taxa väljs i kostnadsräkningen, inte vid nytt ärende (#1613).
    expect(createdOnce()).not.toHaveProperty("isTaxeArende");
  });

  it("Nytt ärende har ingen Taxeärende-kryssruta (#1613)", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /\+ Nytt ärende/i }));
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText("Taxeärende")).toBeNull();
    expect(screen.queryByText(/Domstolsverkets fastställda taxa/)).toBeNull();
  });

  it("Målnummer-rutan visas alltid i Nytt ärende, även utan klient (#1509)", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /\+ Nytt ärende/i }));
    expect(screen.getByLabelText("Målnummer")).toBeInTheDocument();
  });

  it("tom/blank Målnummer-ruta → inget courtCaseNumber skickas (#1509)", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /\+ Nytt ärende/i }));
    fireEvent.change(screen.getByLabelText(/Titel/), { target: { value: "Tvist AB" } });
    fireEvent.change(screen.getByLabelText("Målnummer"), { target: { value: "   " } });
    await submit();
    expect(createdOnce().courtCaseNumber).toBeUndefined();
  });

  it("ifyllt Målnummer skickas trimmat som courtCaseNumber (#1509)", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /\+ Nytt ärende/i }));
    fireEvent.change(screen.getByLabelText(/Titel/), { target: { value: "Tvist AB" } });
    fireEvent.change(screen.getByLabelText("Målnummer"), { target: { value: "  B 1234-26 " } });
    await submit();
    expect(createdOnce()).toEqual(expect.objectContaining({ courtCaseNumber: "B 1234-26" }));
  });

  it("byrån saknar ärendetyper → Ärendetyp är en fritext-ruta", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /\+ Nytt ärende/i }));
    const input = screen.getByLabelText("Ärendetyp");
    expect(input.tagName).toBe("INPUT");
    fireEvent.change(screen.getByLabelText(/Titel/), { target: { value: "Dödsbo" } });
    fireEvent.change(input, { target: { value: "Egen typ" } });
    await submit();
    expect(createdOnce()).toEqual(expect.objectContaining({ matterType: "Egen typ" }));
  });

  it("byrån har ärendetyper → Ärendetyp väljs ur listan", async () => {
    matterTypes = ["Bodelning", "God man"];
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /\+ Nytt ärende/i }));
    const select = screen.getByLabelText("Ärendetyp");
    expect(select.tagName).toBe("SELECT");
    expect(screen.getByRole("option", { name: "God man" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Titel/), { target: { value: "Dödsbo" } });
    fireEvent.change(select, { target: { value: "God man" } });
    await submit();
    expect(createdOnce()).toEqual(expect.objectContaining({ matterType: "God man" }));
  });

  it("paginering: Nästa följt av Föregående går tillbaka till sida 1", async () => {
    mattersData = { matters: [], total: 50, pages: 3 };
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Nästa/i }));
    await settle();
    expect(screen.getByText(/Sida 2 av 3/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Föregående/i }));
    await settle();
    expect(screen.getByText(/Sida 1 av 3/)).toBeInTheDocument();
  });
});

describe("MattersPage — Välj klient via sökdialog (#1128)", () => {
  beforeEach(() => {
    searchHits = [];
  });

  async function openPicker(): Promise<void> {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /\+ Nytt ärende/i }));
    fireEvent.click(screen.getByRole("button", { name: /Välj klient/ }));
  }

  it("ingen dropdown längre — 'Välj klient…' öppnar en sökdialog", async () => {
    await openPicker();
    expect(screen.queryByRole("combobox", { name: /Klient/ })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Välj klient" })).toBeInTheDocument();
  });

  it("söker och väljer en befintlig klient — ärendet skapas med den", async () => {
    searchHits = [{ id: "c-anna", name: "Anna Karlsson", contactType: "PERSON", personalNumber: "19800101-1234" }];
    await openPicker();
    const dialog = screen.getByRole("dialog", { name: "Välj klient" });
    fireEvent.change(within(dialog).getByRole("searchbox"), { target: { value: "Anna" } });
    await settle();
    expect(callsTo(fake, "contacts.search").at(-1)).toEqual({ term: "Anna" });
    fireEvent.click(within(dialog).getByRole("button", { name: /Anna Karlsson/ }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Anna Karlsson")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Titel/), { target: { value: "Bodelning" } });
    await submit();
    expect(createdOnce()).toEqual(expect.objectContaining({ title: "Bodelning", klientId: "c-anna" }));
  });

  it("hittas inte klienten → 'Ny klient…' med sökordet förifyllt; OK skapar och väljer den", async () => {
    await openPicker();
    fireEvent.change(within(screen.getByRole("dialog", { name: "Välj klient" })).getByRole("searchbox"), { target: { value: "Nya Klienten AB" } });
    await settle();
    expect(screen.getByText(/Ingen träff/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Ny klient/ }));

    const dialog = screen.getByRole("dialog", { name: "Ny klient" });
    expect((within(dialog).getByLabelText<HTMLInputElement>(/Namn/)).value).toBe("Nya Klienten AB");
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await settle();
    expect(callsTo(fake, "contacts.create")).toEqual([expect.objectContaining({ name: "Nya Klienten AB" })]);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Titel/), { target: { value: "Avtalstvist" } });
    await submit();
    expect(createdOnce()).toEqual(expect.objectContaining({ klientId: "c-new" }));
  });

  it("Avbryt i 'Ny klient' skapar inget och går tillbaka till sökningen", async () => {
    await openPicker();
    fireEvent.click(screen.getByRole("button", { name: /Ny klient/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Ny klient" })).getByRole("button", { name: "Avbryt" }));
    expect(callsTo(fake, "contacts.create")).toEqual([]);
    expect(screen.getByRole("dialog", { name: "Välj klient" })).toBeInTheDocument();
  });

  it("vald klient kan tas bort igen", async () => {
    searchHits = [{ id: "c-anna", name: "Anna Karlsson", contactType: "PERSON" }];
    await openPicker();
    fireEvent.change(within(screen.getByRole("dialog")).getByRole("searchbox"), { target: { value: "Anna" } });
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /Anna Karlsson/ }));
    fireEvent.click(screen.getByRole("button", { name: "Ta bort vald klient" }));
    expect(screen.getByRole("button", { name: /Välj klient/ })).toBeInTheDocument();
  });
});

describe("ClientPickerDialog — startvärde för sökrutan (#1644)", () => {
  beforeEach(() => {
    searchHits = [{ id: "c-anna", name: "Anna Karlsson", contactType: "PERSON" }];
  });

  it("med initialTerm är sökrutan ifylld och träffarna visas direkt", async () => {
    renderTrpc(<ClientPickerDialog initialTerm="Anna" onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole<HTMLInputElement>("searchbox").value).toBe("Anna");
    await settle();
    expect(callsTo(fake, "contacts.search").at(-1)).toEqual({ term: "Anna" });
    expect(screen.getByRole("button", { name: /Anna Karlsson/ })).toBeInTheDocument();
  });

  it("utan initialTerm är sökrutan tom som förut", () => {
    renderTrpc(<ClientPickerDialog onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole<HTMLInputElement>("searchbox").value).toBe("");
    expect(screen.getByText("Skriv för att söka.")).toBeInTheDocument();
  });

  it("'+ Ny klient…' får startvärdet som namn", () => {
    renderTrpc(<ClientPickerDialog initialTerm="Nya Klienten AB" onPick={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Ny klient/ }));
    const dialog = screen.getByRole("dialog", { name: "Ny klient" });
    expect(within(dialog).getByLabelText<HTMLInputElement>(/Namn/).value).toBe("Nya Klienten AB");
  });
});

describe("MattersPage — titel och klient fyller i varandra (#1644)", () => {
  beforeEach(() => {
    searchHits = [{ id: "c-anna", name: "Anna Karlsson", contactType: "PERSON" }];
  });

  async function openForm(): Promise<void> {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /\+ Nytt ärende/i }));
  }

  function titleInput(): HTMLInputElement {
    return screen.getByLabelText<HTMLInputElement>(/Titel/);
  }

  it("titel → sökrutan är ifylld med den trimmade titeln", async () => {
    await openForm();
    fireEvent.change(titleInput(), { target: { value: "  Anna Karlsson  " } });
    fireEvent.click(screen.getByRole("button", { name: /Välj klient/ }));
    await settle();
    const dialog = screen.getByRole("dialog", { name: "Välj klient" });
    expect(within(dialog).getByRole<HTMLInputElement>("searchbox").value).toBe("Anna Karlsson");
    expect(within(dialog).getByRole("button", { name: /Anna Karlsson/ })).toBeInTheDocument();
  });

  it("tom titel (bara mellanslag) → tom sökruta", async () => {
    await openForm();
    fireEvent.change(titleInput(), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /Välj klient/ }));
    expect(within(screen.getByRole("dialog")).getByRole<HTMLInputElement>("searchbox").value).toBe("");
  });

  it("klient vald med tom titel → titeln får klientens namn", async () => {
    await openForm();
    fireEvent.click(screen.getByRole("button", { name: /Välj klient/ }));
    fireEvent.change(within(screen.getByRole("dialog")).getByRole("searchbox"), { target: { value: "Anna" } });
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /Anna Karlsson/ }));
    expect(titleInput().value).toBe("Anna Karlsson");
    await submit();
    expect(createdOnce()).toEqual(expect.objectContaining({ title: "Anna Karlsson", klientId: "c-anna" }));
  });

  it("nyskapad klient med tom titel → titeln får klientens namn", async () => {
    await openForm();
    fireEvent.click(screen.getByRole("button", { name: /Välj klient/ }));
    fireEvent.click(screen.getByRole("button", { name: /Ny klient/ }));
    const dialog = screen.getByRole("dialog", { name: "Ny klient" });
    fireEvent.change(within(dialog).getByLabelText(/Namn/), { target: { value: "Nya Klienten AB" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await settle();
    expect(titleInput().value).toBe("Nya Klienten AB");
  });

  it("ifylld titel rörs inte när klienten väljs", async () => {
    await openForm();
    fireEvent.change(titleInput(), { target: { value: "Bodelning" } });
    fireEvent.click(screen.getByRole("button", { name: /Välj klient/ }));
    fireEvent.change(within(screen.getByRole("dialog")).getByRole("searchbox"), { target: { value: "Anna" } });
    await settle();
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
    mattersData = { matters: sortableMatters(), total: 4, pages: 1 };
  });

  it("varje kolumn sorterar på det som visas", async () => {
    await renderPage();
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

  it("Täckning visar procent med varning nära och över taket, '—' utan tak; taxeflaggan ensam märks inte Taxa", async () => {
    await renderPage();
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

  it("märket Taxa följer isTaxeMatter: offentligt uppdrag och taxeflaggan (#1971)", async () => {
    const row = (id: string, title: string, paymentMethod: string, isTaxeArende: boolean) => ({
      id, matterNumber: `2026-00${id}`, title, status: "ACTIVE", matterType: null, isTaxeArende, paymentMethod,
      contacts: [], parties: [], _count: { contacts: 0 },
    });
    mattersData = {
      matters: [row("11", "Privat", "PRIVAT", true), row("12", "Offentligt", "OFFENTLIGT_UPPDRAG", true), row("13", "Utan", "OFFENTLIGT_UPPDRAG", false)],
      total: 3, pages: 1,
    };
    await renderPage();
    expect(within(rowWith("Privat")).queryByTitle(/^Taxeärende/)).toBeNull();
    expect(within(rowWith("Offentligt")).getByTitle(/^Taxeärende/)).toHaveTextContent("Taxa");
    expect(within(rowWith("Utan")).queryByTitle(/^Taxeärende/)).toBeNull();
  });

  it("filter på Täckning väljer på etiketten", async () => {
    await renderPage();
    openColumnMenu("Täckning (tak)");
    fireEvent.change(screen.getByPlaceholderText("Skriv för att filtrera…"), { target: { value: "över" } });
    fireEvent.click(screen.getByRole("button", { name: "Tillämpa" }));
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.queryByText("Alfa")).toBeNull();
    expect(screen.queryByText("Delta")).toBeNull();
  });
});

describe("MattersPage — formulärets händelser (#1903)", () => {
  it("när ärendet skapats stängs formuläret och listan laddas om", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /\+ Nytt ärende/i }));
    fireEvent.change(screen.getByLabelText("Titel *"), { target: { value: "Tvist" } });
    await submit();
    expect(invalidatedPaths(invalidate)).toContain("matter.list");
    expect(screen.queryByRole("button", { name: /Skapa ärende/i })).toBeNull();
  });

  it("ansvarig jurist väljs ur byråns användare och skickas med", async () => {
    employees = [{ id: "u2", name: "Eva Ek" }];
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /\+ Nytt ärende/i }));
    fireEvent.change(screen.getByLabelText("Titel *"), { target: { value: "Tvist" } });
    fireEvent.change(screen.getByLabelText("Ansvarig advokat/jurist"), { target: { value: "u2" } });
    await submit();
    expect(createdOnce()).toEqual(expect.objectContaining({ responsibleLawyerId: "u2" }));
  });

  it("medarbetarfiltret skickar vald medarbetare till listan", async () => {
    employees = [{ id: "u2", name: "Eva Ek" }];
    onAllTab();
    await renderPage();
    const filter = screen.getAllByRole("combobox").find(
      (el) => within(el).queryByRole("option", { name: "Alla medarbetare" }) !== null,
    ) as HTMLSelectElement;
    fireEvent.change(filter, { target: { value: "u2" } });
    expect(filter.value).toBe("u2");
    expect(lastListInput()).toMatchObject({ employeeId: "u2" });
  });

  it("klientdialogen stängs med Avbryt utan att välja klient", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /\+ Nytt ärende/i }));
    fireEvent.click(screen.getByRole("button", { name: /Välj klient/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Avbryt" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /Välj klient/ })).toBeInTheDocument();
  });
});

describe("MattersPage — flikarna Mitt aktskåp och Alla ärenden på byrån (#1968)", () => {
  const statusSelect = (): HTMLSelectElement | undefined => screen.queryAllByRole("combobox").find(
    (el) => within(el).queryByRole("option", { name: "Alla statusar" }) !== null,
  ) as HTMLSelectElement | undefined;

  it("utan flik är Mitt aktskåp vald: egna aktiva ärenden, senast hänt överst, inga valrutor", async () => {
    await renderPage();
    const tabs = within(screen.getByRole("tablist", { name: "Ärendelistor" })).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Mitt aktskåp", "Alla ärenden på byrån"]);
    expect(screen.getByRole("tab", { name: "Mitt aktskåp" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Mitt aktskåp" })).toBeInTheDocument();
    expect(lastListInput()).toEqual({ search: "", mine: true, status: "ACTIVE", orderBy: "lastActivity", page: 1, pageSize: 20 });
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(screen.getByPlaceholderText(/Sök ärenden/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sök" })).toBeInTheDocument();
  });

  it("Mitt aktskåp läses om varje gång (staleTime 0), Alla ärenden på byrån har ingen egen staleTime", async () => {
    const view = await renderPage();
    expect(listStaleTime({ mine: true })).toBe(0);
    onAllTab();
    await rerenderPage(view);
    expect(listStaleTime({ mine: undefined })).toBeUndefined();
  });

  it("tom flik utan söktext: 'Du är inte ansvarig …'; med söktext 'Inga ärenden.'", async () => {
    await renderPage();
    expect(screen.getByText("Du är inte ansvarig för något aktivt ärende.")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Sök ärenden/), { target: { value: "x" } });
    expect(screen.getByText("Inga ärenden.")).toBeInTheDocument();
    expect(screen.queryByText("Du är inte ansvarig för något aktivt ärende.")).toBeNull();
  });

  it("flik=alla: dagens argument, valrutorna syns och en tom lista visar 'Inga ärenden.'", async () => {
    onAllTab();
    await renderPage();
    expect(screen.getByRole("tab", { name: "Alla ärenden på byrån" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Alla ärenden på byrån" })).toBeInTheDocument();
    expect(lastListInput()).toEqual({ search: "", status: undefined, employeeId: undefined, page: 1, pageSize: 20 });
    expect(statusSelect()).toBeDefined();
    expect(screen.getByText("Inga ärenden.")).toBeInTheDocument();
  });

  it("ett klick på en flik byter adress med router.replace", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Alla ärenden på byrån" }));
    expect(routerReplace).toHaveBeenLastCalledWith("/matters/?flik=alla");
    fireEvent.click(screen.getByRole("tab", { name: "Mitt aktskåp" }));
    expect(routerReplace).toHaveBeenLastCalledWith("/matters/");
  });

  it("sidan går tillbaka till 1 när flik ändras i adressen utan klick", async () => {
    mattersData = { matters: [], total: 50, pages: 3 };
    const view = await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Nästa/i }));
    await settle();
    expect(lastListInput()).toMatchObject({ page: 2 });
    onAllTab();
    await rerenderPage(view);
    expect(lastListInput()).toMatchObject({ page: 1 });
    expect(screen.getByText(/Sida 1 av 3/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Nästa/i }));
    await settle();
    expect(lastListInput()).toMatchObject({ page: 2 });
  });

  it("DataTable får list.matters-mine respektive list.matters", async () => {
    const view = await renderPage();
    expect(callsTo(fake, "prefs.get").at(-1)).toEqual({ key: "list.matters-mine" });
    onAllTab();
    await rerenderPage(view);
    expect(callsTo(fake, "prefs.get").at(-1)).toEqual({ key: "list.matters" });
  });

  it("valrutornas värden står kvar när man byter flik och sedan tillbaka", async () => {
    onAllTab();
    const view = await renderPage();
    const select = statusSelect();
    if (!select) throw new Error("statusvalet saknas");
    fireEvent.change(select, { target: { value: "CLOSED" } });
    searchParamsGet.mockReturnValue(null);
    await rerenderPage(view);
    expect(statusSelect()).toBeUndefined();
    onAllTab();
    await rerenderPage(view);
    expect(statusSelect()?.value).toBe("CLOSED");
    expect(lastListInput()).toMatchObject({ status: "CLOSED" });
  });
});
