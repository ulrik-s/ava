"use client";

/**
 * Rubrikmenyn i `DataTable` (Sortera/Filtrera/Gruppera/Dölj), utbruten ur
 * `data-table.tsx` (#2043) så att tabellen får plats med radmarkeringen.
 * Beteendet är oförändrat.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Column, DataTablePrefs, MenuPosition, SortDir } from "./data-table-logic";
import { isFilterable, isGroupable } from "./data-table-logic";

/** Det rubrikcellerna kan ändra i tabellens inställningar. */
export interface HeaderActions {
  setSort: (key: string, dir: SortDir | undefined) => void;
  setFilter: (key: string, value: string) => void;
  setGroupBy: (key: string | undefined) => void;
  hideColumn: (key: string) => void;
  reorder: (from: string, to: string) => void;
  resize: (key: string, width: number) => void;
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

export function ColumnMenu<T>({ col, prefs, actions, onClose, position }: ColumnMenuProps<T>) {
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
