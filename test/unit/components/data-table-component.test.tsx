/**
 * DataTable-komponent — rendering, sort-klick, kolumn-meny, admin-actions.
 * Pure helpers täcks i data-table.test.tsx; här fokuserar vi på UI:t som
 * inte är enkelt att enhets-testa utan att rendera.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DataTable, type Column } from "@/components/ui/data-table";

interface Row { id: string; name: string; age: number }
const cols: Column<Row>[] = [
  { key: "name", label: "Namn", render: (r) => r.name, sortable: true, sortValue: (r) => r.name },
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

  it("klick på sorterbar rubrik triggar save mutation", () => {
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByRole("button", { name: /^Namn$/ }));
    // Save sker debounced (setTimeout 400ms) → kolla att mutationen registrerades efter timeout
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(saveMutate).toHaveBeenCalled();
        resolve();
      }, 500);
    });
  });

  it("onRowClick fires när rad klickas", () => {
    const onRowClick = vi.fn();
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} onRowClick={onRowClick} />);
    fireEvent.click(screen.getByText("Anna"));
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it("kolumn-menyn öppnar och visar checkbox för kolumn", () => {
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByLabelText("Kolumnval"));
    // Båda kolumnerna finns som checkbox-label
    expect(screen.getAllByText("Namn").length).toBeGreaterThan(1); // header + meny
    expect(screen.getAllByText("Ålder").length).toBeGreaterThan(1);
  });

  it("admin ser 'Spara som org-default' när menyn öppnas", () => {
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByLabelText("Kolumnval"));
    expect(screen.getByText(/Spara som org-default/)).toBeInTheDocument();
  });

  it("klick på 'Spara som org-default' anropar setOrgDefault", () => {
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByLabelText("Kolumnval"));
    fireEvent.click(screen.getByText(/Spara som org-default/));
    expect(setOrgMutate).toHaveBeenCalled();
  });

  it("non-admin ser INTE org-default-knappar", () => {
    me.data = { id: "u1", role: "LAWYER" };
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByLabelText("Kolumnval"));
    expect(screen.queryByText(/Spara som org-default/)).not.toBeInTheDocument();
  });

  it("'Återställ mina' visas när det finns personlig pref", () => {
    persisted.data = { user: { sortBy: "name" }, org: null };
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByLabelText("Kolumnval"));
    expect(screen.getByText(/Återställ mina/)).toBeInTheDocument();
  });

  it("'Ta bort org-default' visas för admin när org-pref finns", () => {
    persisted.data = { user: null, org: { sortBy: "age" } };
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByLabelText("Kolumnval"));
    expect(screen.getByText(/Ta bort org-default/)).toBeInTheDocument();
  });
});
