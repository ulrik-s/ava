"use client";

/**
 * `DataTable` — återanvändbar lista med sorterbara/justerbara kolumner.
 *
 * Funktioner:
 *   • Klick på rubrik → sortera asc/desc/none.
 *   • Drag i höger kant → ändra kolumnbredd.
 *   • Drag på rubrik → ordna om kolumner.
 *   • Trepunktsmeny → dölj/visa kolumner, gruppera på kolumn.
 *   • Per-kolumn-text-filter (header-input) när col.filterable=true.
 *   • Footer-prop renderar `<tfoot>`-rad som alignar med kolumnerna —
 *     använd för Summa-rader (utlägg, tid m.fl.).
 *   • "Återställ"-knapp synlig när användaren har överrider:t prefs.
 *   • Allt sparas per user via prefs-API:t. Admin-globala defaults via
 *     prefs.setOrgDefault. Merge: personal > org > komponent-default.
 */

import { useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/client/trpc";

export type SortDir = "asc" | "desc";

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => React.ReactNode;
  /** Pure-data-värde för sortering (default = render-output som sträng). */
  sortValue?: (row: T) => string | number | Date | null;
  /** Värde som filter-text matchas mot (default: render-output som string). */
  filterValue?: (row: T) => string;
  /** Värde som används vid groupering (default: filterValue eller render). */
  groupValue?: (row: T) => string;
  sortable?: boolean;
  filterable?: boolean;
  groupable?: boolean;
  defaultWidth?: number;
  align?: "left" | "right" | "center";
  hideable?: boolean;
}

export interface DataTablePrefs {
  sortBy?: string;
  sortDir?: SortDir;
  /** Synlig kolumn-ordning. Saknade kolumner appendas i komponent-defaultordning. */
  order?: string[];
  /** Per-kolumn-överrides. */
  columns?: Array<{ key: string; width?: number; hidden?: boolean }>;
  /** Per-kolumn-key filter-text (case-insensitive substring-match). */
  filters?: Record<string, string>;
  /** Kolumn-key att gruppera på. Hela tabellen presenteras då i sektioner. */
  groupBy?: string;
}

type FooterFn<T> = (rows: T[]) => Partial<Record<string, React.ReactNode>>;

interface Props<T> {
  prefKey: string;
  columns: Column<T>[];
  data: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  /** Per-kolumn-key footer-innehåll. Renderas i `<tfoot>` så cellerna
   *  alignar med kolumnerna. Använd för Summa-rader. */
  footer?: FooterFn<T>;
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
  const valueOf = col.groupValue ?? col.filterValue ?? ((r: T) => String(col.render(r) ?? ""));
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const k = valueOf(r) || "(tomt)";
    const list = groups.get(k);
    if (list) list.push(r);
    else groups.set(k, [r]);
  }
  return Array.from(groups.entries()).map(([group, gRows]) => ({ group, rows: gRows }));
}

export function visibleColumns<T>(columns: Column<T>[], prefs: DataTablePrefs): Column<T>[] {
  const overrides = new Map((prefs.columns ?? []).map((c) => [c.key, c]));
  const visible = columns.filter((c) => !(overrides.get(c.key)?.hidden));
  if (!prefs.order?.length) return visible;
  const idx = new Map(prefs.order.map((k, i) => [k, i] as const));
  return [...visible].sort((a, b) => (idx.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (idx.get(b.key) ?? Number.MAX_SAFE_INTEGER));
}

function widthOf<T>(col: Column<T>, prefs: DataTablePrefs): number | undefined {
  return prefs.columns?.find((c) => c.key === col.key)?.width ?? col.defaultWidth;
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

export function DataTable<T>({ prefKey, columns, data, rowKey, onRowClick, emptyMessage, footer }: Props<T>) {
  const persisted = trpc.prefs.get.useQuery({ key: prefKey });
  const save = trpc.prefs.save.useMutation();
  const clear = trpc.prefs.clear.useMutation();
  const setOrg = trpc.prefs.setOrgDefault.useMutation();
  const clearOrg = trpc.prefs.clearOrgDefault.useMutation();
  const me = trpc.user.current.useQuery();
  const isAdmin = me.data?.role === "ADMIN";
  const utils = trpc.useUtils();
  const remote = useMemo(
    () => mergePrefs(persisted.data?.user as DataTablePrefs | null, persisted.data?.org as DataTablePrefs | null),
    [persisted.data],
  );
  const [localPrefs, setLocalPrefs] = useState<DataTablePrefs | null>(null);
  const prefs = localPrefs ?? remote;

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persist = (next: DataTablePrefs): void => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save.mutate({ key: prefKey, prefs: next as Record<string, unknown> }), 400);
  };
  const update = (patch: Partial<DataTablePrefs>): void => {
    setLocalPrefs((cur) => {
      const next = { ...(cur ?? remote), ...patch };
      persist(next);
      return next;
    });
  };

  const vCols = useMemo(() => visibleColumns(columns, prefs), [columns, prefs]);
  const sorted = useMemo(() => sortRows(data, columns, prefs.sortBy, prefs.sortDir), [data, columns, prefs.sortBy, prefs.sortDir]);
  const filtered = useMemo(() => filterRows(sorted, columns, prefs.filters), [sorted, columns, prefs.filters]);
  const grouped = useMemo(() => groupRows(filtered, columns, prefs.groupBy), [filtered, columns, prefs.groupBy]);
  const showOverrideBar = hasOverrides(prefs);

  const resetPersonal = (): void => {
    setLocalPrefs({});
    clear.mutate({ key: prefKey }, { onSuccess: () => utils.prefs.get.invalidate({ key: prefKey }) });
  };
  const saveAsOrgDefault = (): void => {
    setOrg.mutate({ key: prefKey, prefs: prefs as Record<string, unknown> }, { onSuccess: () => utils.prefs.get.invalidate({ key: prefKey }) });
  };
  const removeOrgDefault = (): void => {
    clearOrg.mutate({ key: prefKey }, { onSuccess: () => utils.prefs.get.invalidate({ key: prefKey }) });
  };

  return (
    <div>
      {showOverrideBar && (
        <div className="mb-2 flex items-center justify-end">
          <button type="button" onClick={resetPersonal}
            className="text-xs px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 text-gray-700">
            Återställ vy
          </button>
        </div>
      )}
      <div className="overflow-x-auto bg-white border border-gray-200 rounded-lg">
        <table className="min-w-full text-sm">
          <DataTableHeader
            columns={columns} vCols={vCols} prefs={prefs} update={update}
            isAdmin={isAdmin}
            hasPersonalPref={persisted.data?.user != null}
            hasOrgPref={persisted.data?.org != null}
            onResetPersonal={resetPersonal}
            onSaveAsOrgDefault={saveAsOrgDefault}
            onRemoveOrgDefault={removeOrgDefault}
          />
          <tbody className="divide-y divide-gray-100">
            <BodyRows
              grouped={grouped}
              vCols={vCols}
              prefs={prefs}
              rowKey={rowKey}
              onRowClick={onRowClick}
              emptyMessage={emptyMessage}
            />
          </tbody>
          {footer && filtered.length > 0 && (
            <FooterRow vCols={vCols} prefs={prefs} content={footer(filtered)} />
          )}
        </table>
      </div>
    </div>
  );
}

interface BodyProps<T> {
  grouped: RowGroup<T>[];
  vCols: Column<T>[];
  prefs: DataTablePrefs;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
}

function BodyRows<T>({ grouped, vCols, prefs, rowKey, onRowClick, emptyMessage }: BodyProps<T>) {
  const totalCols = vCols.length + 1;
  const isEmpty = grouped.every((g) => g.rows.length === 0);
  if (isEmpty) {
    return (
      <tr><td colSpan={totalCols} className="px-4 py-6 text-center text-sm text-gray-500">{emptyMessage ?? "Inget att visa."}</td></tr>
    );
  }
  return (
    <>{grouped.map((g) => (
      <GroupBlock
        key={g.group ?? "__all"}
        group={g}
        vCols={vCols}
        prefs={prefs}
        rowKey={rowKey}
        onRowClick={onRowClick}
      />
    ))}</>
  );
}

interface GroupBlockProps<T> {
  group: RowGroup<T>;
  vCols: Column<T>[];
  prefs: DataTablePrefs;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
}

function GroupBlock<T>({ group, vCols, prefs, rowKey, onRowClick }: GroupBlockProps<T>) {
  const totalCols = vCols.length + 1;
  return (
    <>
      {group.group !== null && (
        <tr className="bg-blue-50">
          <td colSpan={totalCols} className="px-3 py-2 text-xs font-semibold text-blue-900 uppercase tracking-wide">
            {group.group} <span className="font-normal text-blue-700">({group.rows.length})</span>
          </td>
        </tr>
      )}
      {group.rows.map((r) => (
        <tr key={rowKey(r)} className={onRowClick ? "hover:bg-gray-50 cursor-pointer" : ""} onClick={onRowClick ? () => onRowClick(r) : undefined}>
          {vCols.map((c) => (
            <td key={c.key} style={{ width: widthOf(c, prefs), textAlign: c.align ?? "left" }} className="px-3 py-2 whitespace-nowrap">
              {c.render(r)}
            </td>
          ))}
          <td className="w-4" />
        </tr>
      ))}
    </>
  );
}

interface FooterProps<T> {
  vCols: Column<T>[];
  prefs: DataTablePrefs;
  content: Partial<Record<string, React.ReactNode>>;
}

function FooterRow<T>({ vCols, prefs, content }: FooterProps<T>) {
  return (
    <tfoot>
      <tr className="bg-gray-50 border-t-2 border-gray-200 font-semibold">
        {vCols.map((c) => (
          <td key={c.key} style={{ width: widthOf(c, prefs), textAlign: c.align ?? "left" }}
            className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">
            {content[c.key] ?? ""}
          </td>
        ))}
        <td className="w-4" />
      </tr>
    </tfoot>
  );
}

interface HeaderProps<T> {
  columns: Column<T>[];
  vCols: Column<T>[];
  prefs: DataTablePrefs;
  update: (patch: Partial<DataTablePrefs>) => void;
  isAdmin: boolean;
  hasPersonalPref: boolean;
  hasOrgPref: boolean;
  onResetPersonal: () => void;
  onSaveAsOrgDefault: () => void;
  onRemoveOrgDefault: () => void;
}

function DataTableHeader<T>({ columns, vCols, prefs, update, isAdmin, hasPersonalPref, hasOrgPref, onResetPersonal, onSaveAsOrgDefault, onRemoveOrgDefault }: HeaderProps<T>) {
  const onSort = (key: string): void => {
    const next: DataTablePrefs = prefs.sortBy === key
      ? { ...prefs, sortDir: prefs.sortDir === "asc" ? "desc" : "asc" }
      : { ...prefs, sortBy: key, sortDir: "asc" };
    update(next);
  };
  const onReorder = (from: string, to: string): void => {
    const keys = vCols.map((c) => c.key);
    const fromIdx = keys.indexOf(from);
    const toIdx = keys.indexOf(to);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
    keys.splice(toIdx, 0, ...keys.splice(fromIdx, 1));
    update({ order: keys });
  };
  const onResize = (key: string, width: number): void => {
    const cols = (prefs.columns ?? []).filter((c) => c.key !== key);
    update({ columns: [...cols, { key, width }] });
  };
  const onToggleHidden = (key: string): void => {
    const cur = prefs.columns ?? [];
    const existing = cur.find((c) => c.key === key);
    const next = existing
      ? cur.map((c) => c.key === key ? { ...c, hidden: !c.hidden } : c)
      : [...cur, { key, hidden: true }];
    update({ columns: next });
  };
  const onFilter = (key: string, value: string): void => {
    update({ filters: { ...(prefs.filters ?? {}), [key]: value } });
  };
  const onGroupBy = (key: string | undefined): void => {
    update({ groupBy: key });
  };

  return (
    <thead className="bg-gray-50 text-left">
      <tr>
        {vCols.map((c) => (
          <HeaderCell
            key={c.key} col={c} sortKey={prefs.sortBy} sortDir={prefs.sortDir}
            width={widthOf(c, prefs)}
            filterText={prefs.filters?.[c.key] ?? ""}
            onSort={onSort} onReorder={onReorder} onResize={onResize} onFilter={onFilter}
          />
        ))}
        <th className="px-2 py-2 w-8">
          <ColumnMenu
            columns={columns} prefs={prefs}
            onToggleHidden={onToggleHidden}
            onGroupBy={onGroupBy}
            isAdmin={isAdmin}
            hasPersonalPref={hasPersonalPref}
            hasOrgPref={hasOrgPref}
            onResetPersonal={onResetPersonal}
            onSaveAsOrgDefault={onSaveAsOrgDefault}
            onRemoveOrgDefault={onRemoveOrgDefault}
          />
        </th>
      </tr>
    </thead>
  );
}

interface HeaderCellProps<T> {
  col: Column<T>;
  sortKey?: string;
  sortDir?: SortDir;
  width?: number;
  filterText: string;
  onSort: (key: string) => void;
  onReorder: (from: string, to: string) => void;
  onResize: (key: string, width: number) => void;
  onFilter: (key: string, value: string) => void;
}

function HeaderCell<T>({ col, sortKey, sortDir, width, filterText, onSort, onReorder, onResize, onFilter }: HeaderCellProps<T>) {
  const isSorted = sortKey === col.key;
  const arrow = !isSorted ? "" : sortDir === "asc" ? " ↑" : " ↓";
  return (
    <th
      style={{ width, textAlign: col.align ?? "left" }}
      className="relative px-3 py-2 text-xs font-semibold text-gray-700 select-none align-top"
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/x-col", col.key)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const from = e.dataTransfer.getData("text/x-col"); if (from) onReorder(from, col.key); }}
    >
      <button
        type="button"
        onClick={() => col.sortable && onSort(col.key)}
        className={col.sortable ? "cursor-pointer hover:text-gray-900" : "cursor-default"}
        disabled={!col.sortable}
      >
        {col.label}{arrow}
      </button>
      {col.filterable && (
        <input
          type="text"
          value={filterText}
          onChange={(e) => onFilter(col.key, e.target.value)}
          placeholder="Filter…"
          className="mt-1 block w-full text-xs font-normal border border-gray-200 rounded px-1 py-0.5 focus:outline-none focus:border-blue-400"
          onClick={(e) => e.stopPropagation()}
        />
      )}
      <ResizeHandle width={width} onResize={(w) => onResize(col.key, w)} />
    </th>
  );
}

function ResizeHandle({ width, onResize }: { width?: number; onResize: (width: number) => void }) {
  const onMouseDown = (e: React.MouseEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width ?? (e.currentTarget.parentElement?.getBoundingClientRect().width ?? 120);
    const move = (ev: MouseEvent) => onResize(Math.max(40, startW + (ev.clientX - startX)));
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };
  return <span onMouseDown={onMouseDown} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400" />;
}

interface ColumnMenuProps<T> {
  columns: Column<T>[];
  prefs: DataTablePrefs;
  onToggleHidden: (key: string) => void;
  onGroupBy: (key: string | undefined) => void;
  isAdmin: boolean;
  hasPersonalPref: boolean;
  hasOrgPref: boolean;
  onResetPersonal: () => void;
  onSaveAsOrgDefault: () => void;
  onRemoveOrgDefault: () => void;
}

function ColumnMenu<T>(props: ColumnMenuProps<T>) {
  const { columns, prefs, onToggleHidden, onGroupBy, isAdmin, hasPersonalPref, hasOrgPref, onResetPersonal, onSaveAsOrgDefault, onRemoveOrgDefault } = props;
  const [open, setOpen] = useState(false);
  const hidden = new Set((prefs.columns ?? []).filter((c) => c.hidden).map((c) => c.key));
  const groupable = columns.filter((c) => c.groupable);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-gray-400 hover:text-gray-700" aria-label="Kolumnval">⋯</button>
      {open && (
        <div className="absolute right-0 top-7 z-20 bg-white border border-gray-200 rounded shadow-lg p-2 min-w-[14rem]">
          <p className="px-2 pt-1 pb-2 text-[10px] font-semibold uppercase text-gray-400">Visa kolumner</p>
          {columns.filter((c) => c.hideable !== false).map((c) => (
            <label key={c.key} className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-gray-50 cursor-pointer">
              <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => onToggleHidden(c.key)} />
              <span>{c.label}</span>
            </label>
          ))}
          {groupable.length > 0 && (
            <>
              <div className="my-2 border-t border-gray-100" />
              <p className="px-2 pt-1 pb-1 text-[10px] font-semibold uppercase text-gray-400">Gruppera på</p>
              {groupable.map((c) => (
                <button key={c.key} type="button" onClick={() => { onGroupBy(prefs.groupBy === c.key ? undefined : c.key); setOpen(false); }}
                  className="block w-full text-left px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 rounded">
                  {prefs.groupBy === c.key ? "✓ " : ""}{c.label}
                </button>
              ))}
              {prefs.groupBy && (
                <button type="button" onClick={() => { onGroupBy(undefined); setOpen(false); }}
                  className="block w-full text-left px-2 py-1 text-xs text-gray-500 hover:bg-gray-50 rounded">
                  Ta bort gruppering
                </button>
              )}
            </>
          )}
          <div className="my-2 border-t border-gray-100" />
          {hasPersonalPref && (
            <button type="button" onClick={() => { onResetPersonal(); setOpen(false); }}
              className="block w-full text-left px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 rounded">
              Återställ mina inställningar
            </button>
          )}
          {isAdmin && (
            <>
              <p className="mt-2 px-2 pt-1 pb-1 text-[10px] font-semibold uppercase text-gray-400">Admin</p>
              <button type="button" onClick={() => { onSaveAsOrgDefault(); setOpen(false); }}
                className="block w-full text-left px-2 py-1 text-xs text-blue-700 hover:bg-blue-50 rounded">
                Spara som org-default
              </button>
              {hasOrgPref && (
                <button type="button" onClick={() => { onRemoveOrgDefault(); setOpen(false); }}
                  className="block w-full text-left px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded">
                  Ta bort org-default
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
