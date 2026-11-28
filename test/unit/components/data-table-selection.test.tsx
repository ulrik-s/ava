/**
 * `DataTable` med radmarkering (#2043): kryssruta per rad, "Markera alla" för
 * de synliga rader som går att markera, och en kolumn som inte finns i
 * kolumnmenyn. Utan `selection` finns inga kryssrutor alls.
 */

import { act, fireEvent, renderHook, screen, within, type RenderResult } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { DataTable, type Column } from "@/components/ui/data-table";
import { useRowSelection } from "@/components/ui/data-table-selection";
import { rowWith } from "../../helpers/data-table";
import { renderWithSeededTrpc, seedDataTable } from "../../helpers/trpc-seeded";

interface Row { id: string; name: string; locked: boolean; hours: number }
const cols: Column<Row>[] = [
  { key: "name", label: "Namn", render: (r) => r.name, sortable: true, sortValue: (r) => r.name },
  { key: "hours", label: "Tid", render: (r) => r.hours, summary: (rs) => `Summa ${rs.reduce((s, r) => s + r.hours, 0)}`, defaultWidth: 80 },
];
const rows: Row[] = [
  { id: "a", name: "Anna", locked: false, hours: 1 },
  { id: "b", name: "Bo", locked: true, hours: 2 },
  { id: "c", name: "Cia", locked: false, hours: 3 },
];

const persisted = { data: undefined as undefined | { user: unknown; org: unknown } };
const ME = { id: "u1", role: "LAWYER" };

/** Renderar under en fejkad tRPC-länk; listans val och rollen finns redan i cachen. */
function render(ui: ReactElement): RenderResult {
  return renderWithSeededTrpc(ui, {
    "prefs.get": () => persisted.data ?? { user: null, org: null },
    "user.current": () => ME,
    "prefs.save": () => ({}),
  }, seedDataTable("x", persisted.data, ME));
}

/** Det sidan senast fick som markering. */
const changes = vi.fn((_next: ReadonlySet<string>) => undefined);

/** Sidan äger markeringen, som tidslistorna gör. */
function Page({ onRowClick }: { onRowClick?: ((r: Row) => void) | undefined }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  return (
    <DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} {...(onRowClick ? { onRowClick } : {})}
      selection={{
        selected,
        onChange: (next) => { changes(next); setSelected(next); },
        isSelectable: (r) => !r.locked,
      }} />
  );
}

const rowBox = (text: string): HTMLInputElement => within(rowWith(text)).getByRole<HTMLInputElement>("checkbox", { name: "Markera rad" });
const allBox = (): HTMLInputElement => screen.getByRole<HTMLInputElement>("checkbox", { name: "Markera alla" });

beforeEach(() => {
  vi.clearAllMocks();
  persisted.data = undefined;
});

describe("DataTable — radmarkering (#2043)", () => {
  it("utan selection: inga kryssrutor", () => {
    render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("en rad som inte går att markera saknar kryssruta", () => {
    render(<Page />);
    expect(rowBox("Anna")).toBeInTheDocument();
    expect(within(rowWith("Bo")).queryByRole("checkbox")).toBeNull();
  });

  it("en rad markeras och avmarkeras; Markera alla blir delvis markerad", () => {
    render(<Page />);
    fireEvent.click(rowBox("Anna"));
    expect(rowBox("Anna").checked).toBe(true);
    expect(allBox().checked).toBe(false);
    expect(allBox().indeterminate).toBe(true);
    fireEvent.click(rowBox("Anna"));
    expect(rowBox("Anna").checked).toBe(false);
    expect(allBox().indeterminate).toBe(false);
  });

  it("Markera alla markerar bara rader som går att markera, och av igen", () => {
    render(<Page />);
    fireEvent.click(allBox());
    expect([...(changes.mock.calls.at(-1)?.[0] ?? [])].sort()).toEqual(["a", "c"]);
    expect(allBox().checked).toBe(true);
    fireEvent.click(allBox());
    expect([...(changes.mock.calls.at(-1)?.[0] ?? [])]).toEqual([]);
  });

  it("Markera alla gäller bara synliga rader: filtrerade räknas inte", () => {
    persisted.data = { user: { filters: { name: "cia" } }, org: null };
    render(<Page />);
    fireEvent.click(allBox());
    expect([...(changes.mock.calls.at(-1)?.[0] ?? [])]).toEqual(["c"]);
  });

  it("utan rader att markera är Markera alla avstängd", () => {
    persisted.data = { user: { filters: { name: "bo" } }, org: null };
    render(<Page />);
    expect(allBox().disabled).toBe(true);
  });

  it("klick på kryssrutan öppnar inte raden", () => {
    const onRowClick = vi.fn();
    render(<Page onRowClick={onRowClick} />);
    fireEvent.click(rowBox("Anna"));
    expect(onRowClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Anna"));
    expect(onRowClick).toHaveBeenCalledOnce();
  });

  it("kolumnen finns inte i kolumnmenyn och har ingen rubrikmeny", () => {
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Kolumner" }));
    const group = screen.getByRole("group", { name: "Kolumner" });
    expect(within(group).queryByText(/Markera/)).toBeNull();
    const th = allBox().closest("th");
    expect(th?.querySelector("button")).toBeNull();
    expect(th?.getAttribute("draggable")).toBeNull();
  });

  it("summaraden och grupperingen får en tom cell under kryssrutorna", () => {
    persisted.data = { user: { groupBy: "name" }, org: null };
    const { container } = render(<Page />);
    const footerRow = screen.getByText("Summa 6").closest("tr");
    expect(footerRow?.children).toHaveLength(cols.length + 2);
    expect(screen.getByText("Summa 1").closest("tr")?.children).toHaveLength(cols.length + 2);
    expect(container.querySelector("td[colspan]")?.getAttribute("colspan")).toBe(String(cols.length + 2));
  });

  it("fast tabellbredd räknar med markeringskolumnen", () => {
    persisted.data = { user: { columns: [{ key: "name", width: 100 }] }, org: null };
    const { container, unmount } = render(<DataTable prefKey="x" columns={cols} data={rows} rowKey={(r) => r.id} />);
    expect(container.querySelector("table")?.style.width).toBe("212px");
    unmount();
    const withSelection = render(<Page />);
    expect(withSelection.container.querySelector("table")?.style.width).toBe("244px");
  });
});

describe("useRowSelection", () => {
  it("börjar tom, tar emot nästa markering via onChange och tömmer med clear", () => {
    const { result } = renderHook(() => useRowSelection<Row>());
    expect([...result.current.selection.selected]).toEqual([]);
    act(() => result.current.selection.onChange(new Set(["a", "c"])));
    expect([...result.current.selection.selected]).toEqual(["a", "c"]);
    act(() => result.current.clear());
    expect([...result.current.selection.selected]).toEqual([]);
  });

  it("skickar vidare isSelectable, och utan den går alla rader att markera", () => {
    const isSelectable = (r: Row): boolean => !r.locked;
    expect(renderHook(() => useRowSelection<Row>(isSelectable)).result.current.selection.isSelectable).toBe(isSelectable);
    expect(renderHook(() => useRowSelection<Row>()).result.current.selection.isSelectable).toBeUndefined();
  });

  it("clear är stabil mellan renderingar", () => {
    const { result, rerender } = renderHook(() => useRowSelection<Row>());
    const first = result.current.clear;
    rerender();
    expect(result.current.clear).toBe(first);
  });
});
