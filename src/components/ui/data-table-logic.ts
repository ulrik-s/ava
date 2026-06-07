/**
 * `data-table-logic` — ramverks-agnostisk kärna för `DataTable` (#62): typer +
 * pure sort-/filter-/group-/prefs-funktioner, utbrutna ur den React-tunga
 * `data-table.tsx` (SRP + testbarhet). Komponenten re-exporterar dessa så
 * importörer (och tester) fortsätter peka på `@/components/ui/data-table`.
 */
import type * as React from "react";

export type SortDir = "asc" | "desc";

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => React.ReactNode;
  /** Pure-data-värde för sortering (default = render-output som sträng). */
  sortValue?: (row: T) => string | number | Date | null;
  /** Värde som filter-text matchas mot (default: sortValue eller render-output). */
  filterValue?: (row: T) => string;
  /** Värde som används vid groupering (default: filterValue eller sortValue). */
  groupValue?: (row: T) => string;
  /** Sorterbar? Default: false. När `sortable: true` aktiveras filter + group
   *  automatiskt (kan stängas av per kolumn med `filterable: false` /
   *  `groupable: false`). */
  sortable?: boolean;
  /** Explicit override — default ärver från `sortable`. */
  filterable?: boolean;
  /** Explicit override — default ärver från `sortable`. */
  groupable?: boolean;
  defaultWidth?: number;
  align?: "left" | "right" | "center";
  hideable?: boolean;
  /** Kolumnen finns i katalogen men är inte visad förrän användaren explicit
   *  väljer "+ Visa kolumn → <denna>". Använd för fält som är intressanta
   *  ibland men skulle göra default-vyn för bred (createdAt, IDs, etc.). */
  defaultHidden?: boolean;
  /** Summa-funktion: returnerar innehållet för footer-cellen i denna kolumn.
   *  Om någon kolumn har summary auto-renderas en footer-rad (filtrerade
   *  rader) + en summa-rad per grupp vid gruppering. Caller styr formatering
   *  (currency, minutes, etc.) genom return-värdet. */
  summary?: (rows: T[]) => React.ReactNode;
}

/** En kolumn räknas som filterbar/grupperbar om `sortable` är satt och
 *  flaggorna inte explicit slagits av. */
export function isFilterable<T>(col: Column<T>): boolean {
  return col.filterable ?? Boolean(col.sortable);
}
export function isGroupable<T>(col: Column<T>): boolean {
  return col.groupable ?? Boolean(col.sortable);
}

export interface DataTablePrefs {
  // Fälten får genuint vara explicit `undefined`: `update`/`patch` nollställer
  // en pref genom att sätta nyckeln till `undefined` (se kommentar vid `update`).
  sortBy?: string | undefined;
  sortDir?: SortDir | undefined;
  /** Synlig kolumn-ordning. Saknade kolumner appendas i komponent-defaultordning. */
  order?: string[] | undefined;
  /** Per-kolumn-överrides. */
  columns?: Array<{ key: string; width?: number; hidden?: boolean }> | undefined;
  /** Per-kolumn-key filter-text (case-insensitive substring-match). */
  filters?: Record<string, string> | undefined;
  /** Kolumn-key att gruppera på. Hela tabellen presenteras då i sektioner. */
  groupBy?: string | undefined;
}

const PREF_KEYS = ["sortBy", "sortDir", "order", "columns", "filters", "groupBy"] as const;

export function mergePrefs(user: DataTablePrefs | null | undefined, org: DataTablePrefs | null | undefined): DataTablePrefs {
  const out: DataTablePrefs = {};
  for (const k of PREF_KEYS) {
    const v = user?.[k] ?? org?.[k];
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function coerce(v: unknown): string | number | null {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  return String(v).toLowerCase();
}

function nullCmp(a: string | number | null, b: string | number | null, dir: SortDir): number {
  if (a == null && b == null) return 0;
  return a == null ? (dir === "asc" ? 1 : -1) : (dir === "asc" ? -1 : 1);
}

function compareValues(a: unknown, b: unknown, dir: SortDir): number {
  const ac = coerce(a);
  const bc = coerce(b);
  if (ac == null || bc == null) return nullCmp(ac, bc, dir);
  if (typeof ac === "number" && typeof bc === "number") return dir === "asc" ? ac - bc : bc - ac;
  const as = String(ac);
  const bs = String(bc);
  return dir === "asc" ? as.localeCompare(bs, "sv") : bs.localeCompare(as, "sv");
}

export function sortRows<T>(rows: T[], columns: Column<T>[], sortBy?: string, sortDir?: SortDir): T[] {
  if (!sortBy || !sortDir) return rows;
  const col = columns.find((c) => c.key === sortBy);
  if (!col?.sortable) return rows;
  const valueOf = col.sortValue ?? ((r: T) => String(col.render(r) ?? ""));
  return [...rows].sort((a, b) => compareValues(valueOf(a), valueOf(b), sortDir));
}

function columnValueAsString<T>(col: Column<T>, row: T): string {
  if (col.filterValue) return col.filterValue(row);
  if (col.sortValue) {
    const v = col.sortValue(row);
    if (v == null) return "";
    if (v instanceof Date) return v.toLocaleDateString("sv-SE");
    return String(v);
  }
  return String(col.render(row) ?? "");
}

export function filterRows<T>(rows: T[], columns: Column<T>[], filters?: Record<string, string>): T[] {
  const active = Object.entries(filters ?? {}).filter(([, v]) => v && String(v).trim() !== "");
  if (active.length === 0) return rows;
  const colByKey = new Map(columns.map((c) => [c.key, c]));
  return rows.filter((r) => active.every(([key, text]) => {
    const col = colByKey.get(key);
    if (!col) return true;
    return columnValueAsString(col, r).toLowerCase().includes(String(text).toLowerCase());
  }));
}

export interface RowGroup<T> { group: string | null; rows: T[] }

export function groupRows<T>(rows: T[], columns: Column<T>[], groupBy?: string): RowGroup<T>[] {
  if (!groupBy) return [{ group: null, rows }];
  const col = columns.find((c) => c.key === groupBy);
  if (!col) return [{ group: null, rows }];
  const valueOf = col.groupValue ?? ((r: T) => columnValueAsString(col, r));
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const k = valueOf(r) || "(tomt)";
    const list = groups.get(k);
    if (list) list.push(r);
    else groups.set(k, [r]);
  }
  return Array.from(groups.entries()).map(([group, gRows]) => ({ group, rows: gRows }));
}

/** En kolumn är dold om user explicit satt { hidden: true }, ELLER om
 *  defaultHidden=true och user inte explicit visat den. */
export function isColumnHidden<T>(col: Column<T>, prefs: DataTablePrefs): boolean {
  const override = (prefs.columns ?? []).find((c) => c.key === col.key);
  if (override?.hidden !== undefined) return override.hidden;
  return Boolean(col.defaultHidden);
}

export function visibleColumns<T>(columns: Column<T>[], prefs: DataTablePrefs): Column<T>[] {
  const visible = columns.filter((c) => !isColumnHidden(c, prefs));
  if (!prefs.order?.length) return visible;
  const idx = new Map(prefs.order.map((k, i) => [k, i] as const));
  return [...visible].sort((a, b) => (idx.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (idx.get(b.key) ?? Number.MAX_SAFE_INTEGER));
}

function hasActiveFilter(filters?: Record<string, string>): boolean {
  return Object.values(filters ?? {}).some((v) => v != null && String(v).trim() !== "");
}

function hasColumnOverride(cols?: Array<{ hidden?: boolean; width?: number }>): boolean {
  return (cols ?? []).some((c) => c.hidden || c.width !== undefined);
}

export function hasOverrides(prefs: DataTablePrefs): boolean {
  if (prefs.sortBy || prefs.groupBy) return true;
  if (hasActiveFilter(prefs.filters)) return true;
  if (hasColumnOverride(prefs.columns)) return true;
  return Boolean(prefs.order && prefs.order.length > 0);
}

export function hasSummary<T>(columns: Column<T>[]): boolean {
  return columns.some((c) => c.summary !== undefined);
}

export function buildSummaryContent<T>(columns: Column<T>[], rows: T[]): Partial<Record<string, React.ReactNode>> {
  const out: Partial<Record<string, React.ReactNode>> = {};
  for (const c of columns) {
    if (c.summary) out[c.key] = c.summary(rows);
  }
  return out;
}
