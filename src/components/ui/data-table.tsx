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
      {(showOverrideBar || isAdmin) && (
        <ActivePrefsToolbar
          prefs={prefs}
          columns={columns}
          onClearSort={() => update({ sortBy: undefined, sortDir: undefined })}
          onClearFilter={(key) => update({ filters: { ...(prefs.filters ?? {}), [key]: "" } })}
          onClearGroup={() => update({ groupBy: undefined })}
          onResetAll={resetPersonal}
          isAdmin={isAdmin}
          hasOrgPref={persisted.data?.org != null}
          onSaveAsOrgDefault={saveAsOrgDefault}
          onRemoveOrgDefault={removeOrgDefault}
        />
      )}
      <div className="overflow-x-auto bg-white border border-gray-200 rounded-lg">
        <table className="min-w-full text-sm">
          <DataTableHeader columns={columns} vCols={vCols} prefs={prefs} update={update} />
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

interface ToolbarProps<T> {
  prefs: DataTablePrefs;
  columns: Column<T>[];
  onClearSort: () => void;
  onClearFilter: (key: string) => void;
  onClearGroup: () => void;
  onResetAll: () => void;
  isAdmin: boolean;
  hasOrgPref: boolean;
  onSaveAsOrgDefault: () => void;
  onRemoveOrgDefault: () => void;
}

function labelFor<T>(columns: Column<T>[], key: string): string {
  return columns.find((c) => c.key === key)?.label ?? key;
}

function ActiveChips<T>({ prefs, columns, onClearSort, onClearFilter, onClearGroup }: {
  prefs: DataTablePrefs; columns: Column<T>[];
  onClearSort: () => void; onClearFilter: (key: string) => void; onClearGroup: () => void;
}) {
  const activeFilters = Object.entries(prefs.filters ?? {}).filter(([, v]) => v && String(v).trim() !== "");
  return (
    <>
      {prefs.sortBy && (
        <Chip
          label={`Sortering: ${labelFor(columns, prefs.sortBy)} ${prefs.sortDir === "asc" ? "↑" : "↓"}`}
          onRemove={onClearSort}
        />
      )}
      {activeFilters.map(([k, v]) => (
        <Chip key={k} label={`Filter: ${labelFor(columns, k)}="${v}"`} onRemove={() => onClearFilter(k)} />
      ))}
      {prefs.groupBy && (
        <Chip label={`Gruppering: ${labelFor(columns, prefs.groupBy)}`} onRemove={onClearGroup} />
      )}
    </>
  );
}

function ToolbarAdminButtons({ hasOrgPref, onSaveAsOrgDefault, onRemoveOrgDefault }: {
  hasOrgPref: boolean; onSaveAsOrgDefault: () => void; onRemoveOrgDefault: () => void;
}) {
  return (
    <>
      <button type="button" onClick={onSaveAsOrgDefault}
        className="text-xs px-3 py-1 border border-blue-300 rounded hover:bg-blue-50 text-blue-700">
        Spara som org-default
      </button>
      {hasOrgPref && (
        <button type="button" onClick={onRemoveOrgDefault}
          className="text-xs px-3 py-1 border border-red-300 rounded hover:bg-red-50 text-red-700">
          Ta bort org-default
        </button>
      )}
    </>
  );
}

function ActivePrefsToolbar<T>(props: ToolbarProps<T>) {
  const { prefs, columns, onClearSort, onClearFilter, onClearGroup, onResetAll,
    isAdmin, hasOrgPref, onSaveAsOrgDefault, onRemoveOrgDefault } = props;
  const hasAny = hasOverrides(prefs);
  if (!hasAny && !isAdmin) return null;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <ActiveChips prefs={prefs} columns={columns}
        onClearSort={onClearSort} onClearFilter={onClearFilter} onClearGroup={onClearGroup} />
      <span className="flex-1" />
      {hasAny && (
        <button type="button" onClick={onResetAll}
          className="text-xs px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 text-gray-700">
          Återställ vy
        </button>
      )}
      {isAdmin && (
        <ToolbarAdminButtons hasOrgPref={hasOrgPref}
          onSaveAsOrgDefault={onSaveAsOrgDefault} onRemoveOrgDefault={onRemoveOrgDefault} />
      )}
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-900 border border-blue-200 rounded-full pl-3 pr-1 py-0.5">
      <span>{label}</span>
      <button type="button" onClick={onRemove}
        aria-label="Ta bort"
        className="text-blue-700 hover:bg-blue-200 rounded-full w-5 h-5 flex items-center justify-center">
        ×
      </button>
    </span>
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
}

interface HeaderActions {
  setSort: (key: string, dir: SortDir | undefined) => void;
  setFilter: (key: string, value: string) => void;
  setGroupBy: (key: string | undefined) => void;
  toggleHidden: (key: string) => void;
  reorder: (from: string, to: string) => void;
  resize: (key: string, width: number) => void;
}

function buildHeaderActions<T>(
  prefs: DataTablePrefs,
  vCols: Column<T>[],
  update: (patch: Partial<DataTablePrefs>) => void,
): HeaderActions {
  return {
    setSort: (key, dir) => update({ sortBy: dir ? key : undefined, sortDir: dir }),
    setFilter: (key, value) => update({ filters: { ...(prefs.filters ?? {}), [key]: value } }),
    setGroupBy: (key) => update({ groupBy: key }),
    toggleHidden: (key) => {
      const cur = prefs.columns ?? [];
      const existing = cur.find((c) => c.key === key);
      const next = existing
        ? cur.map((c) => c.key === key ? { ...c, hidden: !c.hidden } : c)
        : [...cur, { key, hidden: true }];
      update({ columns: next });
    },
    reorder: (from, to) => {
      const keys = vCols.map((c) => c.key);
      const fromIdx = keys.indexOf(from);
      const toIdx = keys.indexOf(to);
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
      keys.splice(toIdx, 0, ...keys.splice(fromIdx, 1));
      update({ order: keys });
    },
    resize: (key, width) => {
      const cols = (prefs.columns ?? []).filter((c) => c.key !== key);
      update({ columns: [...cols, { key, width }] });
    },
  };
}

function DataTableHeader<T>({ vCols, prefs, update }: HeaderProps<T>) {
  const actions = buildHeaderActions(prefs, vCols, update);
  return (
    <thead className="bg-gray-50 text-left">
      <tr>
        {vCols.map((c) => (
          <HeaderCell key={c.key} col={c} prefs={prefs} width={widthOf(c, prefs)} actions={actions} />
        ))}
        <th className="px-2 py-2 w-8" />
      </tr>
    </thead>
  );
}

interface HeaderCellProps<T> {
  col: Column<T>;
  prefs: DataTablePrefs;
  width?: number;
  actions: HeaderActions;
}

function sortArrow(prefs: DataTablePrefs, key: string): string {
  if (prefs.sortBy !== key) return "";
  return prefs.sortDir === "asc" ? " ↑" : " ↓";
}

function hasAnyMenu<T>(col: Column<T>): boolean {
  return Boolean(col.sortable || col.filterable || col.groupable || col.hideable !== false);
}

function HeaderCell<T>({ col, prefs, width, actions }: HeaderCellProps<T>) {
  const [open, setOpen] = useState(false);
  const arrow = sortArrow(prefs, col.key);
  const menu = hasAnyMenu(col);
  return (
    <th
      style={{ width, textAlign: col.align ?? "left" }}
      className="relative px-3 py-2 text-xs font-semibold text-gray-700 select-none"
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/x-col", col.key)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const from = e.dataTransfer.getData("text/x-col"); if (from) actions.reorder(from, col.key); }}
    >
      <button
        type="button"
        onClick={() => menu && setOpen(true)}
        className={menu ? "cursor-pointer hover:text-gray-900 inline-flex items-center gap-1" : "cursor-default"}
        disabled={!menu}
        aria-haspopup={menu ? "menu" : undefined}
      >
        <span>{col.label}{arrow}</span>
        {menu && <span className="text-gray-400 text-[10px]">▾</span>}
      </button>
      {open && (
        <ColumnMenu col={col} prefs={prefs} actions={actions} onClose={() => setOpen(false)} align={col.align ?? "left"} />
      )}
      <ResizeHandle width={width} onResize={(w) => actions.resize(col.key, w)} />
    </th>
  );
}

interface ColumnMenuProps<T> {
  col: Column<T>;
  prefs: DataTablePrefs;
  actions: HeaderActions;
  onClose: () => void;
  align: "left" | "right" | "center";
}

function SortSection<T>({ col, prefs, actions, onClose }: {
  col: Column<T>; prefs: DataTablePrefs; actions: HeaderActions; onClose: () => void;
}) {
  const isSortedHere = prefs.sortBy === col.key;
  return (
    <>
      <MenuButton active={isSortedHere && prefs.sortDir === "asc"}
        onClick={() => { actions.setSort(col.key, "asc"); onClose(); }}>
        Sortera stigande ↑
      </MenuButton>
      <MenuButton active={isSortedHere && prefs.sortDir === "desc"}
        onClick={() => { actions.setSort(col.key, "desc"); onClose(); }}>
        Sortera fallande ↓
      </MenuButton>
      {isSortedHere && (
        <MenuButton onClick={() => { actions.setSort(col.key, undefined); onClose(); }}>
          Ta bort sortering
        </MenuButton>
      )}
      <Separator />
    </>
  );
}

function FilterSection<T>({ col, prefs, actions, onClose }: {
  col: Column<T>; prefs: DataTablePrefs; actions: HeaderActions; onClose: () => void;
}) {
  const [draft, setDraft] = useState<string>(prefs.filters?.[col.key] ?? "");
  const submit = (): void => { actions.setFilter(col.key, draft); onClose(); };
  const hasActive = (prefs.filters?.[col.key] ?? "") !== "";
  return (
    <>
      <div className="px-2 py-1.5">
        <label className="block text-[10px] uppercase text-gray-500 mb-1">Filtrera</label>
        <input type="text" value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") onClose(); }}
          autoFocus
          placeholder="Skriv för att filtrera…"
          className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400" />
        <div className="mt-1 flex justify-end gap-1">
          {hasActive && (
            <button type="button" onClick={() => { actions.setFilter(col.key, ""); onClose(); }}
              className="text-[11px] px-2 py-0.5 text-gray-600 hover:bg-gray-50 rounded">Rensa</button>
          )}
          <button type="button" onClick={submit}
            className="text-[11px] px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700">Tillämpa</button>
        </div>
      </div>
      <Separator />
    </>
  );
}

function ColumnMenu<T>({ col, prefs, actions, onClose, align }: ColumnMenuProps<T>) {
  const isGrouped = prefs.groupBy === col.key;
  const posClass = align === "right" ? "right-0" : "left-0";
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className={`absolute top-full mt-1 z-40 ${posClass} min-w-[14rem] bg-white border border-gray-200 rounded shadow-lg p-1 text-left font-normal`}>
        {col.sortable && <SortSection col={col} prefs={prefs} actions={actions} onClose={onClose} />}
        {col.filterable && <FilterSection col={col} prefs={prefs} actions={actions} onClose={onClose} />}
        {col.groupable && (
          <>
            <MenuButton active={isGrouped}
              onClick={() => { actions.setGroupBy(isGrouped ? undefined : col.key); onClose(); }}>
              {isGrouped ? "Sluta gruppera" : "Gruppera på den här"}
            </MenuButton>
            <Separator />
          </>
        )}
        {col.hideable !== false && (
          <MenuButton onClick={() => { actions.toggleHidden(col.key); onClose(); }}>
            Dölj kolumn
          </MenuButton>
        )}
      </div>
    </>
  );
}

function MenuButton({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`block w-full text-left px-3 py-1.5 text-xs rounded ${active ? "bg-blue-50 text-blue-900 font-semibold" : "text-gray-700 hover:bg-gray-50"}`}>
      {children}
    </button>
  );
}

function Separator() {
  return <div className="my-1 border-t border-gray-100" />;
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

