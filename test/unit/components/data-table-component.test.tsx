/**
 * DataTable-komponent — rendering + per-kolumn-meny + toolbar med chips.
 *
 * UI-mönstret (Excel-stil): klick på kolumn-rubrik öppnar dropdown med
 * Sortera/Filtrera/Gruppera/Dölj. Aktiva val visas som chips i toolbar.
 * Admin-knappar (Spara org-default etc.) sitter i samma toolbar.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { render, screen, fireEvent } from "@testing-library/react";
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

  it("'+ Visa kolumn'-knapp dyker upp i toolbar när någon kolumn är dold", () => {
    persisted.data = { user: { columns: [{ key: "age", hidden: true }] }, org: null };
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    expect(screen.getByText(/\+ Visa kolumn/)).toBeInTheDocument();
  });

  it("klick på '+ Visa kolumn' öppnar lista med dolda kolumner", () => {
    persisted.data = { user: { columns: [{ key: "age", hidden: true }] }, org: null };
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByText(/\+ Visa kolumn/));
    expect(screen.getByText("Dolda kolumner")).toBeInTheDocument();
    // "Ålder" finns både i lista och i header (osynlig pga hidden)
    const ages = screen.getAllByText("Ålder");
    expect(ages.length).toBeGreaterThanOrEqual(1);
  });

  it("'+ Visa kolumn' visas INTE när inga kolumner är dolda", () => {
    persisted.data = { user: { sortBy: "name" }, org: null };
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    expect(screen.queryByText(/\+ Visa kolumn/)).not.toBeInTheDocument();
  });
});
