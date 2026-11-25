"use client";

/**
 * Flikrad (#1966), efter telefonvyns flikrad (#1185). En flik i taget är vald;
 * är `active` ingen av flikarnas id är ingen vald. Varje flik kan ha valfritt
 * innehåll direkt efter sig, t.ex. en knapp som stänger den.
 */

import type { ReactNode } from "react";

/** En flik i en {@link TabBar}. */
export interface TabBarTab<T extends string> {
  id: T;
  label: string;
  /** Står direkt efter fliken (t.ex. ×-knappen som tar bort den). */
  after?: ReactNode;
}

/** Props för {@link TabBar}. */
export interface TabBarProps<T extends string> {
  tabs: readonly TabBarTab<T>[];
  /** Den valda flikens id; `undefined` eller ett okänt id betyder att ingen är vald. */
  active: T | undefined;
  onSelect: (id: T) => void;
  /** Flikradens tillgängliga namn (`aria-label`). */
  ariaLabel: string;
}

const TAB_CLASS = "whitespace-nowrap rounded px-3 py-1.5 text-sm font-semibold dark:font-normal";
const SELECTED_CLASS = "bg-blue-600 text-white";
const UNSELECTED_CLASS = "text-gray-700 hover:bg-gray-100";

/** En flikrad där en flik är vald, med valfritt innehåll efter varje flik. */
export function TabBar<T extends string>({ tabs, active, onSelect, ariaLabel }: TabBarProps<T>) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
      {tabs.map((t) => {
        const selected = t.id === active;
        return (
          <span key={t.id} className="flex items-center">
            <button type="button" role="tab" aria-selected={selected} onClick={() => onSelect(t.id)}
              className={`${TAB_CLASS} ${selected ? SELECTED_CLASS : UNSELECTED_CLASS}`}>
              {t.label}
            </button>
            {t.after}
          </span>
        );
      })}
    </div>
  );
}
