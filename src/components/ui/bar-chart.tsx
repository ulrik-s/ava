"use client";

/**
 * Generellt stapeldiagram (#2110) i HTML och Tailwind, utan diagrambibliotek
 * och utan domänkunskap. Varje stapel är en knapp: ett klick, eller Enter och
 * mellanslag på en fokuserad stapel, väljer den. Höjden är proportionell mot
 * det största värdet, och en stapel med 0 syns som en tunn linje som ändå går
 * att välja. Ryms inte staplarna skrollar diagrammet i sidled inom sin ruta.
 */

import type { KeyboardEvent } from "react";

/** En stapel i en {@link BarChart}. */
export interface BarChartBar {
  /** Stabil nyckel; skickas till `onSelect`. */
  key: string;
  /** Kort etikett under stapeln. */
  label: string;
  /** Stapelns värde (≥ 0). */
  value: number;
  /** Stapelns tillgängliga namn (`aria-label`), t.ex. "Måndag 24 november: 6,5 h". */
  ariaLabel: string;
}

/** Props för {@link BarChart}. */
export interface BarChartProps {
  bars: readonly BarChartBar[];
  /** Nyckeln för den valda stapeln, eller null när ingen är vald. */
  selectedKey: string | null;
  /** Anropas med stapelns nyckel när den väljs. */
  onSelect: (key: string) => void;
}

/** Högsta stapelns höjd i procent; resten av ytan är luft ovanför. */
const MAX_HEIGHT_PCT = 100;

/** Stapelns höjd i procent av diagrammets höjd (0 när det största värdet är 0). */
function barHeightPct(value: number, max: number): number {
  return max > 0 ? (value / max) * MAX_HEIGHT_PCT : 0;
}

/** Enter och mellanslag väljer stapeln (och inte webbläsarens klick efteråt). */
function selectOnKey(e: KeyboardEvent<HTMLButtonElement>, select: () => void): void {
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  select();
}

/** Ett stapeldiagram där varje stapel är en knapp med `aria-pressed`. */
export function BarChart({ bars, selectedKey, onSelect }: BarChartProps) {
  const max = bars.reduce((m, b) => Math.max(m, b.value), 0);
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max items-end gap-1">
        {bars.map((b) => {
          const selected = b.key === selectedKey;
          return (
            <button
              key={b.key}
              type="button"
              aria-label={b.ariaLabel}
              aria-pressed={selected}
              onClick={() => onSelect(b.key)}
              onKeyDown={(e) => selectOnKey(e, () => onSelect(b.key))}
              className="flex w-10 flex-col items-center gap-1 rounded px-0.5 pt-1 hover:bg-gray-100"
            >
              <span className="flex h-32 w-full items-end">
                <span
                  data-bar
                  style={{ height: `${barHeightPct(b.value, max)}%` }}
                  className={`block min-h-0.5 w-full rounded-t ${selected ? "bg-blue-700" : "bg-blue-400"}`}
                />
              </span>
              <span className="whitespace-nowrap text-[10px] text-gray-600">{b.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
