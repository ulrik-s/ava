"use client";

/**
 * Radmarkeringens celler i `DataTable` (#2043): kryssrutan "Markera alla" i
 * rubriken och en kryssruta per rad. Kolumnen ligger först, går inte att dölja,
 * sortera eller flytta, och finns bara när sidan skickar `selection`.
 * Logiken (vilka rader, av/på, delvis markerad) står i `data-table-logic.ts`.
 */

import { useEffect, useMemo, useRef } from "react";
import { selectableKeys, selectAllState, toggleAll, toggleRow, type RowSelection } from "./data-table-logic";

const CELL_CLASS = "px-2 py-2 w-8 align-top";

/** Markeringskolumnens bredd i px (`w-8`), som räknas in i tabellens fasta bredd. */
const SELECTION_COL_WIDTH = 32;

/** "Markera alla" för de synliga rader som går att markera; delvis markerad när bara några är det. */
export function SelectAllHeaderCell<T>({ selection, keys }: { selection: RowSelection<T>; keys: readonly string[] }) {
  const ref = useRef<HTMLInputElement>(null);
  const state = selectAllState(selection.selected, keys);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);
  return (
    <th className={CELL_CLASS}>
      <input ref={ref} type="checkbox" aria-label="Markera alla" checked={state === "all"}
        disabled={keys.length === 0}
        onChange={() => selection.onChange(toggleAll(selection.selected, keys))} />
    </th>
  );
}

/** Radens kryssruta. En rad som inte går att markera får en tom cell. */
export function SelectRowCell<T>({ selection, row, rowId }: { selection: RowSelection<T>; row: T; rowId: string }) {
  const selectable = selection.isSelectable?.(row) ?? true;
  return (
    <td className={CELL_CLASS} onClick={(e) => e.stopPropagation()}>
      {selectable && (
        <input type="checkbox" aria-label="Markera rad" checked={selection.selected.has(rowId)}
          onChange={() => selection.onChange(toggleRow(selection.selected, rowId))} />
      )}
    </td>
  );
}

/** Tom cell under markeringskolumnen i grupp-, summa- och fotrader. */
export function SelectionSpacer({ show }: { show: boolean }) {
  return show ? <td className="w-8" /> : null;
}

/** Markeringskolumnen för tabellen: rubrikcellen och om kolumnen finns. */
export interface SelectionColumn {
  /** "Markera alla"-cellen, eller inget utan markering. */
  header: React.ReactNode;
  /** Kolumnen finns: en extra cell först i varje rad. */
  lead: boolean;
  /** Kolumnens bredd i px för tabellens fasta bredd: 0 utan markering. */
  width: number;
}

/** Markeringskolumnen för de synliga (filtrerade) raderna; utan `selection` finns den inte. */
export function useSelectionColumn<T>(
  selection: RowSelection<T> | undefined, visibleRows: readonly T[], rowKey: (row: T) => string,
): SelectionColumn {
  const isSelectable = selection?.isSelectable;
  const keys = useMemo(() => selectableKeys(visibleRows, rowKey, isSelectable), [visibleRows, rowKey, isSelectable]);
  if (!selection) return { header: null, lead: false, width: 0 };
  return { header: <SelectAllHeaderCell selection={selection} keys={keys} />, lead: true, width: SELECTION_COL_WIDTH };
}
