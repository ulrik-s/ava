"use client";

/**
 * `DataTable` — återanvändbar lista med sorterbara/justerbara kolumner.
 *
 * Funktioner:
 *   • Klick på rubrik → sortera asc/desc/none.
 *   • Drag i höger kant → ändra kolumnbredd.
 *   • Drag på rubrik → ordna om kolumner.
 *   • Rubrikmeny → sortera, filtrera, gruppera, dölj kolumn.
 *   • "Kolumner"-knapp → alla kolumner som kryssrutor (visa/dölj på ett ställe).
 *   • Per-kolumn-text-filter (header-input) när col.filterable=true.
 *   • Footer-prop renderar `<tfoot>`-rad som alignar med kolumnerna —
 *     använd för Summa-rader (utlägg, tid m.fl.).
 *   • "Återställ"-knapp synlig när användaren har överrider:t prefs.
 *   • Allt sparas per user via prefs-API:t. Admin-globala defaults via
 *     prefs.setOrgDefault. Merge: personal > org > komponent-default.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { trpc } from "@/lib/client/trpc";

// Pure logik + typer bor i `data-table-logic.ts` (#62, SRP). Re-exporteras här
// så importörer + tester fortsätter peka på "@/components/ui/data-table".
import type { SortDir, Column, DataTablePrefs, MenuPosition, RowGroup } from "./data-table-logic";
import {
  isFilterable, isGroupable, mergePrefs, sortRows, filterRows, groupRows,
  isColumnHidden, visibleColumns, hasOverrides, hasSummary, buildSummaryContent, hideBelowClass,
  withColumnHidden, menuPosition, withColumnWidth, withColumnWidths, fixedTableWidth,
} from "./data-table-logic";

export type { SortDir, Column, DataTablePrefs, RowGroup } from "./data-table-logic";
export {
  isFilterable, isGroupable, mergePrefs, sortRows, filterRows, groupRows,
  isColumnHidden, visibleColumns, hasOverrides, hasSummary, buildSummaryContent, hideBelowClass,
} from "./data-table-logic";

type FooterFn<T> = (rows: T[]) => Partial<Record<string, React.ReactNode>>;

/** Fast layout när alla kolumner har bredd (se `fixedTableWidth`), annars automatisk. */
function tableLayout(fixedWidth: number | null): { className: string; style?: React.CSSProperties } {
  return fixedWidth === null
    ? { className: "min-w-full text-sm" }
    : { className: "text-sm table-fixed", style: { width: fixedWidth, minWidth: "100%" } };
}

/** Patch (explicit `undefined` rensar en nyckel) eller en funktion av aktuellt tillstånd. */
type PrefsPatch = { [K in keyof DataTablePrefs]?: DataTablePrefs[K] | undefined };
type Update = (patchOrFn: PrefsPatch | ((cur: DataTablePrefs) => PrefsPatch)) => void;

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

function widthOf<T>(col: Column<T>, prefs: DataTablePrefs): number | undefined {
  return prefs.columns?.find((c) => c.key === col.key)?.width ?? col.defaultWidth;
}

/** Cell-klass för data-rader: wrappande kolumner bryter text över flera rader,
 *  övriga håller `nowrap` (default). */
function cellClass<T>(col: Column<T>): string {
  const wrap = col.wrap ? "whitespace-normal break-words" : "whitespace-nowrap";
  return `px-3 py-2 ${wrap} ${hideBelowClass(col)}`.trimEnd();
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
  // Patch tillåter explicit `undefined` per nyckel — det är så vi RENSAR
  // en pref (spread `{ ...cur, key: undefined }` nollställer fältet).
  // En funktion av aktuellt tillstånd får också skickas in — en kolumndragning
  // skickar många uppdateringar ur samma closure och måste bygga på den senaste,
  // inte på tillståndet när dragningen började (#1170).
  const update: Update = (patchOrFn) => {
    setLocalPrefs((cur) => {
      const base = cur ?? remote;
      const next = { ...base, ...(typeof patchOrFn === "function" ? patchOrFn(base) : patchOrFn) };
      persist(next);
      return next;
    });
  };

  const vCols = useMemo(() => visibleColumns(columns, prefs), [columns, prefs]);
  const sorted = useMemo(() => sortRows(data, columns, prefs.sortBy, prefs.sortDir), [data, columns, prefs.sortBy, prefs.sortDir]);
  const filtered = useMemo(() => filterRows(sorted, columns, prefs.filters), [sorted, columns, prefs.filters]);
  const grouped = useMemo(() => groupRows(filtered, columns, prefs.groupBy), [filtered, columns, prefs.groupBy]);
  const showOverrideBar = hasOverrides(prefs);
  const fixedWidth = fixedTableWidth(vCols, prefs);

  const resetPersonal = (): void => {
    setLocalPrefs({});
    clear.mutate({ key: prefKey }, { onSuccess: () => { void utils.prefs.get.invalidate({ key: prefKey }); } });
  };
  const saveAsOrgDefault = (): void => {
    setOrg.mutate({ key: prefKey, prefs: prefs as Record<string, unknown> }, { onSuccess: () => { void utils.prefs.get.invalidate({ key: prefKey }); } });
  };
  const removeOrgDefault = (): void => {
    clearOrg.mutate({ key: prefKey }, { onSuccess: () => { void utils.prefs.get.invalidate({ key: prefKey }); } });
  };

  return (
    <div>
      {(showOverrideBar || isAdmin || hideableColumns(columns).length > 0) && (
        <ActivePrefsToolbar
          prefs={prefs}
          columns={columns}
          onClearSort={() => update({ sortBy: undefined, sortDir: undefined })}
          onClearFilter={(key) => update({ filters: { ...(prefs.filters ?? {}), [key]: "" } })}
          onClearGroup={() => update({ groupBy: undefined })}
          onSetHidden={(key, hidden) => update({ columns: withColumnHidden(prefs, key, hidden) })}
          onResetAll={resetPersonal}
          isAdmin={isAdmin}
          hasOrgPref={persisted.data?.org != null}
          onSaveAsOrgDefault={saveAsOrgDefault}
          onRemoveOrgDefault={removeOrgDefault}
        />
      )}
      <div className="overflow-x-auto bg-white border border-gray-200 rounded-lg">
        <table {...tableLayout(fixedWidth)}>
          <DataTableHeader columns={columns} vCols={vCols} prefs={prefs} update={update} />
          <tbody className="divide-y divide-gray-100">
            <BodyRows
              grouped={grouped}
              vCols={vCols}
              prefs={prefs}
              rowKey={rowKey}
              onRowClick={onRowClick}
              emptyMessage={emptyMessage}
              columns={columns}
            />
          </tbody>
          <AutoFooter columns={columns} vCols={vCols} prefs={prefs} filtered={filtered} footer={footer} />
        </table>
      </div>
    </div>
  );
}

interface AutoFooterProps<T> {
  columns: Column<T>[];
  vCols: Column<T>[];
  prefs: DataTablePrefs;
  filtered: T[];
  footer?: FooterFn<T> | undefined;
}

function AutoFooter<T>({ columns, vCols, prefs, filtered, footer }: AutoFooterProps<T>) {
  if (filtered.length === 0) return null;
  if (!footer && !hasSummary(columns)) return null;
  const content = footer ? footer(filtered) : buildSummaryContent(columns, filtered);
  return <FooterRow vCols={vCols} prefs={prefs} content={content} />;
}

interface ToolbarProps<T> {
  prefs: DataTablePrefs;
  columns: Column<T>[];
  onClearSort: () => void;
  onClearFilter: (key: string) => void;
  onClearGroup: () => void;
  onSetHidden: (key: string, hidden: boolean) => void;
  onResetAll: () => void;
  isAdmin: boolean;
  hasOrgPref: boolean;
  onSaveAsOrgDefault: () => void;
  onRemoveOrgDefault: () => void;
}

/** Kolumner användaren kan visa/dölja (hideable !== false). */
function hideableColumns<T>(columns: Column<T>[]): Column<T>[] {
  return columns.filter((c) => c.hideable !== false);
}

/**
 * "Kolumner" — alltid synlig när tabellen har kolumner som kan döljas. Alla
 * kolumner som kryssrutor; valfria fält (`defaultHidden`) i en egen grupp.
 * Förr fanns bara "+ Visa kolumn", som syntes först när något redan var dolt.
 */
function ColumnsButton<T>({ columns, prefs, onSetHidden }: {
  columns: Column<T>[]; prefs: DataTablePrefs; onSetHidden: (key: string, hidden: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const cols = hideableColumns(columns);
  if (cols.length === 0) return null;
  const hiddenCount = cols.filter((c) => isColumnHidden(c, prefs)).length;
  const visibleCount = columns.length - columns.filter((c) => isColumnHidden(c, prefs)).length;
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="text-xs px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 text-gray-700 inline-flex items-center gap-1">
        Kolumner{hiddenCount > 0 && <span className="text-gray-400">({hiddenCount} dolda)</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div role="group" aria-label="Kolumner"
            className="absolute right-0 top-full mt-1 z-40 min-w-[14rem] max-h-96 overflow-y-auto bg-white border border-gray-200 rounded shadow-lg p-1">
            <ColumnChecks label="Kolumner" cols={cols.filter((c) => !c.defaultHidden)} prefs={prefs}
              lastVisible={visibleCount <= 1} onSetHidden={onSetHidden} />
            <ColumnChecks label="Fler fält" cols={cols.filter((c) => c.defaultHidden)} prefs={prefs}
              lastVisible={visibleCount <= 1} onSetHidden={onSetHidden} />
          </div>
        </>
      )}
    </div>
  );
}

/** En grupp kryssrutor. Sista synliga kolumnen går inte att dölja (tom tabell). */
function ColumnChecks<T>({ label, cols, prefs, lastVisible, onSetHidden }: {
  label: string; cols: Column<T>[]; prefs: DataTablePrefs; lastVisible: boolean;
  onSetHidden: (key: string, hidden: boolean) => void;
}) {
  if (cols.length === 0) return null;
  return (
    <>
      <p className="px-2 pt-1 pb-1 text-[10px] font-semibold uppercase text-gray-400">{label}</p>
      {cols.map((c) => {
        const visible = !isColumnHidden(c, prefs);
        return (
          <label key={c.key} className="flex items-center gap-2 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 rounded cursor-pointer">
            <input type="checkbox" checked={visible} disabled={visible && lastVisible}
              onChange={() => onSetHidden(c.key, visible)} />
            {c.label}
          </label>
        );
      })}
    </>
  );
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
  const { prefs, columns, onClearSort, onClearFilter, onClearGroup, onSetHidden, onResetAll,
    isAdmin, hasOrgPref, onSaveAsOrgDefault, onRemoveOrgDefault } = props;
  const hasAny = hasOverrides(prefs);
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <ActiveChips prefs={prefs} columns={columns}
        onClearSort={onClearSort} onClearFilter={onClearFilter} onClearGroup={onClearGroup} />
      <span className="flex-1" />
      <ColumnsButton columns={columns} prefs={prefs} onSetHidden={onSetHidden} />
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
  onRowClick?: ((row: T) => void) | undefined;
  emptyMessage?: string | undefined;
  columns: Column<T>[];
}

function BodyRows<T>({ grouped, vCols, prefs, rowKey, onRowClick, emptyMessage, columns }: BodyProps<T>) {
  const totalCols = vCols.length + 1;
  const isEmpty = grouped.every((g) => g.rows.length === 0);
  if (isEmpty) {
    return (
      <tr><td colSpan={totalCols} className="px-4 py-6 text-center text-sm text-gray-500">{emptyMessage ?? "Inget att visa."}</td></tr>
    );
  }
  // Bara visa per-grupp summa när vi faktiskt grupperar OCH det finns summary
  const showGroupSummary = prefs.groupBy != null && hasSummary(columns);
  return (
    <>{grouped.map((g) => (
      <GroupBlock
        key={g.group ?? "__all"}
        group={g}
        vCols={vCols}
        prefs={prefs}
        rowKey={rowKey}
        onRowClick={onRowClick}
        showSummary={showGroupSummary}
        columns={columns}
      />
    ))}</>
  );
}

interface GroupBlockProps<T> {
  group: RowGroup<T>;
  vCols: Column<T>[];
  prefs: DataTablePrefs;
  rowKey: (row: T) => string;
  onRowClick?: ((row: T) => void) | undefined;
  showSummary: boolean;
  columns: Column<T>[];
}

function GroupSummaryRow<T>({ vCols, prefs, content }: { vCols: Column<T>[]; prefs: DataTablePrefs; content: Partial<Record<string, React.ReactNode>> }) {
  // Per-grupp-summa: light = bg-gray-100 (något mörkare än white-rader);
  // dark = slate-700 (ljusare än slate-800-rader, dvs "elevated"-tier).
  // Båda lägena ger ~5:1 kontrast på texten + tydlig border-300/slate-600.
  // Följer Material Design 3 surface-tiers + WCAG AA.
  return (
    <tr className="bg-gray-100 border-t border-gray-300 text-xs font-semibold text-gray-800">
      {vCols.map((c) => (
        <td key={c.key} style={{ width: widthOf(c, prefs), textAlign: c.align ?? "left" }}
          className={`px-3 py-1.5 whitespace-nowrap ${hideBelowClass(c)}`.trimEnd()}>
          {content[c.key] ?? ""}
        </td>
      ))}
      <td className="w-4" />
    </tr>
  );
}

function GroupBlock<T>({ group, vCols, prefs, rowKey, onRowClick, showSummary, columns }: GroupBlockProps<T>) {
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
            <td key={c.key} style={{ width: widthOf(c, prefs), textAlign: c.align ?? "left" }} className={cellClass(c)}>
              {c.render(r)}
            </td>
          ))}
          <td className="w-4" />
        </tr>
      ))}
      {showSummary && (
        <GroupSummaryRow vCols={vCols} prefs={prefs} content={buildSummaryContent(columns, group.rows)} />
      )}
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
            className={`px-3 py-2 whitespace-nowrap text-sm text-gray-900 ${hideBelowClass(c)}`.trimEnd()}>
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
  update: Update;
}

interface HeaderActions {
  setSort: (key: string, dir: SortDir | undefined) => void;
  setFilter: (key: string, value: string) => void;
  setGroupBy: (key: string | undefined) => void;
  hideColumn: (key: string) => void;
  reorder: (from: string, to: string) => void;
  resize: (key: string, width: number) => void;
}

function buildHeaderActions<T>(
  prefs: DataTablePrefs,
  vCols: Column<T>[],
  update: Update,
): HeaderActions {
  return {
    setSort: (key, dir) => update({ sortBy: dir ? key : undefined, sortDir: dir }),
    setFilter: (key, value) => update({ filters: { ...(prefs.filters ?? {}), [key]: value } }),
    setGroupBy: (key) => update({ groupBy: key }),
    // Rubrikmenyn visas bara på synliga kolumner → dölj (buggfix: förr sattes
    // `hidden: false` här, så "Dölj kolumn" gjorde ingenting).
    hideColumn: (key) => update({ columns: withColumnHidden(prefs, key, true) }),
    reorder: (from, to) => {
      const keys = vCols.map((c) => c.key);
      const fromIdx = keys.indexOf(from);
      const toIdx = keys.indexOf(to);
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
      keys.splice(toIdx, 0, ...keys.splice(fromIdx, 1));
      update({ order: keys });
    },
    // Funktion av aktuellt tillstånd (inte `prefs` ur closuren) och behåll
    // dold-flaggan — förr skrevs posten om till bara { key, width } (#1170).
    resize: (key, width) => update((cur) => ({ columns: withColumnWidth(cur, key, width) })),
  };
}

function DataTableHeader<T>({ vCols, prefs, update }: HeaderProps<T>) {
  const actions = buildHeaderActions(prefs, vCols, update);
  const theadRef = useRef<HTMLTableSectionElement>(null);
  // När man börjar dra: frys ALLA kolumners nuvarande bredd, så tabellen kan gå
  // över till fast layout och bara kolumnen man drar i ändras (#1170).
  const freezeWidths = (): void => update((cur) => {
    if (fixedTableWidth(vCols, cur) !== null) return {};
    const widths: Record<string, number> = {};
    theadRef.current?.querySelectorAll<HTMLTableCellElement>("th[data-col-key]").forEach((th) => {
      const w = Math.round(th.getBoundingClientRect().width);
      if (w > 0 && th.dataset.colKey) widths[th.dataset.colKey] = w;
    });
    return { columns: withColumnWidths(cur, widths) };
  });
  return (
    <thead ref={theadRef} className="bg-gray-50 text-left">
      <tr>
        {vCols.map((c) => (
          <HeaderCell key={c.key} col={c} prefs={prefs} width={widthOf(c, prefs)} actions={actions} onResizeStart={freezeWidths} />
        ))}
        <th className="px-2 py-2 w-8" />
      </tr>
    </thead>
  );
}

interface HeaderCellProps<T> {
  col: Column<T>;
  prefs: DataTablePrefs;
  width?: number | undefined;
  actions: HeaderActions;
  onResizeStart: () => void;
}

function sortArrow(prefs: DataTablePrefs, key: string): string {
  if (prefs.sortBy !== key) return "";
  return prefs.sortDir === "asc" ? " ↑" : " ↓";
}

function hasAnyMenu<T>(col: Column<T>): boolean {
  return Boolean(col.sortable || isFilterable(col) || isGroupable(col) || col.hideable !== false);
}

function HeaderCell<T>({ col, prefs, width, actions, onResizeStart }: HeaderCellProps<T>) {
  const [open, setOpen] = useState<MenuPosition | null>(null);
  const [resizing, setResizing] = useState(false);
  const thRef = useRef<HTMLTableCellElement>(null);
  const openMenu = (): void => {
    const rect = thRef.current?.getBoundingClientRect();
    if (rect) setOpen(menuPosition(rect, col.align ?? "left", { width: window.innerWidth, height: window.innerHeight }));
  };
  const arrow = sortArrow(prefs, col.key);
  const menu = hasAnyMenu(col);
  return (
    <th
      ref={thRef}
      data-col-key={col.key}
      style={{ width, textAlign: col.align ?? "left" }}
      className={`relative px-3 py-2 text-xs font-semibold text-gray-700 select-none ${hideBelowClass(col)}`.trimEnd()}
      draggable={!resizing}
      onDragStart={(e) => e.dataTransfer.setData("text/x-col", col.key)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const from = e.dataTransfer.getData("text/x-col"); if (from) actions.reorder(from, col.key); }}
    >
      <button
        type="button"
        onClick={() => menu && openMenu()}
        className={menu ? "cursor-pointer hover:text-gray-900 inline-flex items-center gap-1" : "cursor-default"}
        disabled={!menu}
        aria-haspopup={menu ? "menu" : undefined}
      >
        <span>{col.label}{arrow}</span>
        {menu && <span className="text-gray-400 text-[10px]">▾</span>}
      </button>
      {open && (
        <ColumnMenu col={col} prefs={prefs} actions={actions} onClose={() => setOpen(null)} position={open} />
      )}
      <ResizeHandle width={width} onResize={(w) => actions.resize(col.key, w)}
        onActive={(active) => { if (active) onResizeStart(); setResizing(active); }} />
    </th>
  );
}

interface ColumnMenuProps<T> {
  col: Column<T>;
  prefs: DataTablePrefs;
  actions: HeaderActions;
  onClose: () => void;
  position: MenuPosition;
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

/** Stäng menyn när sidan scrollar eller ändrar storlek — den är fäst i fönstret. */
function useCloseOnScroll(onClose: () => void): void {
  useEffect(() => {
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);
}

function ColumnMenu<T>({ col, prefs, actions, onClose, position }: ColumnMenuProps<T>) {
  const isGrouped = prefs.groupBy === col.key;
  useCloseOnScroll(onClose);
  // Portal: utanför tabellens overflow-behållare (#1152), se `menuPosition`.
  return createPortal(
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div role="menu" style={{ ...position, position: "fixed" }}
        className="z-40 min-w-[14rem] overflow-y-auto bg-white border border-gray-200 rounded shadow-lg p-1 text-left text-sm font-normal">
        {col.sortable && <SortSection col={col} prefs={prefs} actions={actions} onClose={onClose} />}
        {isFilterable(col) && <FilterSection col={col} prefs={prefs} actions={actions} onClose={onClose} />}
        {isGroupable(col) && (
          <>
            <MenuButton active={isGrouped}
              onClick={() => { actions.setGroupBy(isGrouped ? undefined : col.key); onClose(); }}>
              {isGrouped ? "Sluta gruppera" : "Gruppera på den här"}
            </MenuButton>
            <Separator />
          </>
        )}
        {col.hideable !== false && (
          <MenuButton onClick={() => { actions.hideColumn(col.key); onClose(); }}>
            Dölj kolumn
          </MenuButton>
        )}
      </div>
    </>,
    document.body,
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

/**
 * Dra i kolumnens högerkant för att ändra bredd (#1170). Rubrikcellen är
 * `draggable` (flytta kolumner) — i Chrome startade en musnedtryckning här en
 * inbyggd HTML-dragning av hela rubriken, och under den kommer inga
 * mousemove-händelser: markören ändrades men bredden aldrig. Därför: pointer
 * events med pointer capture (fungerar även med touch/iPad), och rubriken är
 * inte dragbar medan man ändrar bredd (`onActive`).
 */
function ResizeHandle({ width, onResize, onActive }: {
  width?: number | undefined; onResize: (width: number) => void; onActive: (active: boolean) => void;
}) {
  const onPointerDown = (e: React.PointerEvent<HTMLSpanElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    const startX = e.clientX;
    const startW = width ?? (handle.parentElement?.getBoundingClientRect().width ?? 120);
    handle.setPointerCapture?.(e.pointerId);
    onActive(true);
    const move = (ev: PointerEvent) => onResize(Math.max(40, startW + (ev.clientX - startX)));
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      onActive(false);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };
  return (
    <span onPointerDown={onPointerDown} draggable={false} role="separator" aria-orientation="vertical" aria-label="Ändra kolumnbredd"
      className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize touch-none hover:bg-blue-400" />
  );
}

