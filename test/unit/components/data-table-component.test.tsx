/**
 * DataTable-komponent — rendering + per-kolumn-meny + toolbar med chips.
 *
 * UI-mönstret (Excel-stil): klick på kolumn-rubrik öppnar dropdown med
 * Sortera/Filtrera/Gruppera/Dölj. Aktiva val visas som chips i toolbar.
 * Admin-knappar (Spara org-default etc.) sitter i samma toolbar.
 */

import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { DataTable, type Column } from "@/components/ui/data-table";

interface Row { id: string; name: string; age: number }
const cols: Column<Row>[] = [
  { key: "name", label: "Namn", render: (r) => r.name, sortable: true, sortValue: (r) => r.name, filterable: true, groupable: true },
  { key: "age", label: "Ålder", render: (r) => r.age, sortable: true, sortValue: (r) => r.age, align: "right" },
];
const rows: Row[] = [
  { id: "a", name: "Anna", age: 25 },
  { id: "b", name: "Bo", age: 40 },
];

const saveMutate = vi.fn();
const clearMutate = vi.fn();
const setOrgMutate = vi.fn();
const clearOrgMutate = vi.fn();
const me = { data: { id: "u1", role: "ADMIN" as string } };
const persisted = { data: undefined as undefined | { user: unknown; org: unknown } };

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ prefs: { get: { invalidate: vi.fn() } } }),
    user: { current: { useQuery: () => me } },
    prefs: {
      get: { useQuery: () => ({ data: persisted.data, isLoading: false }) },
      save: { useMutation: () => ({ mutate: saveMutate, isPending: false }) },
      clear: { useMutation: () => ({ mutate: clearMutate, isPending: false }) },
      setOrgDefault: { useMutation: () => ({ mutate: setOrgMutate, isPending: false }) },
      clearOrgDefault: { useMutation: () => ({ mutate: clearOrgMutate, isPending: false }) },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  me.data = { id: "u1", role: "ADMIN" };
  persisted.data = undefined;
});

describe("DataTable", () => {
  it("renderar rubriker och rader", () => {
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    expect(screen.getByText("Namn")).toBeInTheDocument();
    expect(screen.getByText("Ålder")).toBeInTheDocument();
    expect(screen.getByText("Anna")).toBeInTheDocument();
    expect(screen.getByText("Bo")).toBeInTheDocument();
  });

  it("visar emptyMessage när data är tom", () => {
    render(<DataTable prefKey="x" columns={cols} data={[]} rowKey={(r) => r.id} emptyMessage="Inget här" />);
    expect(screen.getByText("Inget här")).toBeInTheDocument();
  });

  it("klick på rubrik öppnar kolumn-meny med Sortera-alternativ", () => {
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByRole("button", { name: /Namn/ }));
    expect(screen.getByText("Sortera stigande ↑")).toBeInTheDocument();
    expect(screen.getByText("Sortera fallande ↓")).toBeInTheDocument();
  });

  it("klick på Sortera stigande triggar save mutation", () => {
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByRole("button", { name: /Namn/ }));
    fireEvent.click(screen.getByText("Sortera stigande ↑"));
    return new Promise<void>((resolve) => {
      setTimeout(() => { expect(saveMutate).toHaveBeenCalled(); resolve(); }, 500);
    });
  });

  it("kolumn-meny visar Filtrera-input för filterable column", () => {
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByRole("button", { name: /Namn/ }));
    expect(screen.getByPlaceholderText(/Skriv för att filtrera/)).toBeInTheDocument();
  });

  it("kolumn-meny visar 'Gruppera på den här' för groupable column", () => {
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByRole("button", { name: /Namn/ }));
    expect(screen.getByText("Gruppera på den här")).toBeInTheDocument();
  });

  it("kolumn-meny visar 'Dölj kolumn'", () => {
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByRole("button", { name: /Namn/ }));
    expect(screen.getByText("Dölj kolumn")).toBeInTheDocument();
  });

  it("rubrikmenyn renderas UTANFÖR tabellens scroll-behållare (#1152)", () => {
    const { container } = render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByRole("button", { name: /Namn/ }));
    const menu = screen.getByRole("menu");
    expect(container.querySelector(".overflow-x-auto")?.contains(menu)).toBe(false);
    expect(menu.style.position).toBe("fixed");
  });

  it("rubrikmenyn stängs när sidan scrollar", () => {
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByRole("button", { name: /Namn/ }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.scroll(window);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("'Dölj kolumn' döljer faktiskt kolumnen (buggfix)", () => {
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByRole("button", { name: /Ålder/ }));
    fireEvent.click(screen.getByText("Dölj kolumn"));
    expect(screen.queryByRole("columnheader", { name: /Ålder/ })).not.toBeInTheDocument();
    expect(screen.queryByText("25")).not.toBeInTheDocument();
  });

  it("onRowClick fires när rad klickas", () => {
    const onRowClick = vi.fn();
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} onRowClick={onRowClick} />);
    fireEvent.click(screen.getByText("Anna"));
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it("admin ser 'Spara som org-default' i toolbar (alltid synlig)", () => {
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    expect(screen.getByText(/Spara som org-default/)).toBeInTheDocument();
  });

  it("klick på 'Spara som org-default' anropar setOrgDefault", () => {
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByText(/Spara som org-default/));
    expect(setOrgMutate).toHaveBeenCalled();
  });

  it("non-admin ser INTE org-default-knappar", () => {
    me.data = { id: "u1", role: "LAWYER" };
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    expect(screen.queryByText(/Spara som org-default/)).not.toBeInTheDocument();
  });

  it("'Återställ vy'-knapp visas när det finns personlig pref", () => {
    persisted.data = { user: { sortBy: "name", sortDir: "asc" }, org: null };
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    expect(screen.getByText(/Återställ vy/)).toBeInTheDocument();
  });

  it("'Ta bort org-default' visas för admin när org-pref finns", () => {
    persisted.data = { user: null, org: { sortBy: "age" } };
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    expect(screen.getByText(/Ta bort org-default/)).toBeInTheDocument();
  });

  it("aktiv sortering visas som chip i toolbar", () => {
    persisted.data = { user: { sortBy: "name", sortDir: "desc" }, org: null };
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    expect(screen.getByText(/Sortering: Namn ↓/)).toBeInTheDocument();
  });

  it("aktivt filter visas som chip i toolbar", () => {
    persisted.data = { user: { filters: { name: "anna" } }, org: null };
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    expect(screen.getByText(/Filter: Namn="anna"/)).toBeInTheDocument();
  });

  it("aktiv gruppering visas som chip i toolbar", () => {
    persisted.data = { user: { groupBy: "name" }, org: null };
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    expect(screen.getByText(/Gruppering: Namn/)).toBeInTheDocument();
  });

  it("'Kolumner'-knappen syns alltid (även utan dolda kolumner och för icke-admin)", () => {
    me.data = { id: "u1", role: "LAWYER" };
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    expect(screen.getByRole("button", { name: "Kolumner" })).toBeInTheDocument();
  });

  it("'Kolumner' visar antal dolda + alla kolumner som kryssrutor", () => {
    persisted.data = { user: { columns: [{ key: "age", hidden: true }] }, org: null };
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByRole("button", { name: /Kolumner.*1 dolda/ }));
    const group = screen.getByRole("group", { name: "Kolumner" });
    expect(within(group).getByRole("checkbox", { name: "Namn" })).toBeChecked();
    expect(within(group).getByRole("checkbox", { name: "Ålder" })).not.toBeChecked();
  });

  it("kryssa av en kolumn → den döljs; kryssa i → den kommer tillbaka", () => {
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByRole("button", { name: "Kolumner" }));
    const age = () => within(screen.getByRole("group", { name: "Kolumner" })).getByRole("checkbox", { name: "Ålder" });
    fireEvent.click(age());
    expect(screen.queryByText("25")).not.toBeInTheDocument();
    fireEvent.click(age());
    expect(screen.getByText("25")).toBeInTheDocument();
  });

  it("sista synliga kolumnen går inte att dölja", () => {
    persisted.data = { user: { columns: [{ key: "age", hidden: true }] }, org: null };
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByRole("button", { name: /Kolumner/ }));
    expect(within(screen.getByRole("group", { name: "Kolumner" })).getByRole("checkbox", { name: "Namn" })).toBeDisabled();
  });

  it("valfria fält (defaultHidden) ligger under 'Fler fält'; kolumner som inte får döljas saknas", () => {
    const withExtra: Column<Row>[] = [
      { ...cols[0]!, hideable: false },
      cols[1]!,
      { key: "id", label: "Id", render: (r) => r.id, defaultHidden: true },
    ];
    render(<DataTable prefKey="x" columns={withExtra} data={rows} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByRole("button", { name: /Kolumner/ }));
    const group = screen.getByRole("group", { name: "Kolumner" });
    expect(within(group).getByText("Fler fält")).toBeInTheDocument();
    expect(within(group).getByRole("checkbox", { name: "Id" })).not.toBeChecked();
    expect(within(group).queryByRole("checkbox", { name: "Namn" })).not.toBeInTheDocument();
  });

  it("inga kolumner som kan döljas → ingen 'Kolumner'-knapp", () => {
    me.data = { id: "u1", role: "LAWYER" };
    render(<DataTable prefKey="x" columns={cols.map((c) => ({ ...c, hideable: false }))} data={rows} rowKey={(r) => r.id} />);
    expect(screen.queryByRole("button", { name: /Kolumner/ })).not.toBeInTheDocument();
  });
});

// ── Footer / summa-rader + chip-borttagning + unhide-interaktioner ──────

const colsSummary: Column<Row>[] = [
  { key: "name", label: "Namn", render: (r) => r.name, sortable: true, sortValue: (r) => r.name, groupable: true },
  { key: "age", label: "Ålder", render: (r) => r.age, align: "right", summary: (rs) => `Σ ${rs.reduce((s, r) => s + r.age, 0)}` },
];

describe("DataTable — footer/summa + interaktioner", () => {
  it("kolumn med summary auto-renderar en footer-summa-rad", () => {
    render(<DataTable prefKey="x" columns={colsSummary} data={rows} rowKey={(r) => r.id} />);
    expect(screen.getByText("Σ 65")).toBeInTheDocument(); // 25 + 40
  });

  it("explicit footer-prop renderar footer-cell-innehåll", () => {
    render(
      <DataTable
        prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id}
        footer={(rs) => ({ age: `Antal ${rs.length}` })}
      />,
    );
    expect(screen.getByText("Antal 2")).toBeInTheDocument();
  });

  it("gruppering + summary → en summa-rad per grupp", () => {
    persisted.data = { user: { groupBy: "name" }, org: null };
    render(<DataTable prefKey="x" columns={colsSummary} data={rows} rowKey={(r) => r.id} />);
    // En grupp per namn (Anna=25, Bo=40) → två grupp-summa-rader + en total-footer.
    expect(screen.getByText("Σ 25")).toBeInTheDocument();
    expect(screen.getByText("Σ 40")).toBeInTheDocument();
  });

  it("klick på chip-kryss (Ta bort) rensar sorteringen → persist", () => {
    persisted.data = { user: { sortBy: "name", sortDir: "asc" }, org: null };
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByRole("button", { name: "Ta bort" }));
    return new Promise<void>((resolve) => {
      setTimeout(() => { expect(saveMutate).toHaveBeenCalled(); resolve(); }, 500);
    });
  });

  it("visa kolumn via 'Kolumner' triggar persist", () => {
    persisted.data = { user: { columns: [{ key: "age", hidden: true }] }, org: null };
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByRole("button", { name: /Kolumner/ }));
    fireEvent.click(within(screen.getByRole("group", { name: "Kolumner" })).getByRole("checkbox", { name: "Ålder" }));
    return new Promise<void>((resolve) => {
      setTimeout(() => { expect(saveMutate).toHaveBeenCalled(); resolve(); }, 500);
    });
  });
});
