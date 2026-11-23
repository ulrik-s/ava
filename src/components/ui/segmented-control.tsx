"use client";

/**
 * Knappgrupp för ett val bland några få alternativ (#1804), efter statusfiltret
 * under Avbetalningar. Högst ett alternativ är valt; är `value` inget av
 * alternativen är inget valt. Ej valda alternativ har primärknapparnas blå färg
 * så att det syns att de går att trycka på, och det valda är nedtonat i grått
 * (utan att se avstängt ut).
 */

/** Ett alternativ i en {@link SegmentedControl}. */
export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/** Props för {@link SegmentedControl}. */
export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  /** Det valda värdet; ett värde utanför `options` betyder att inget är valt. */
  value: T | null;
  onChange: (value: T) => void;
  /** Gruppens tillgängliga namn (`aria-label`). */
  ariaLabel: string;
}

const SELECTED_CLASS = "bg-gray-200 text-gray-700";
const UNSELECTED_CLASS = "bg-blue-600 text-white hover:bg-blue-700";

/** Ett val bland några få alternativ, som knappar med `aria-pressed`. */
export function SegmentedControl<T extends string>({ options, value, onChange, ariaLabel }: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex overflow-hidden rounded-md border border-gray-200 divide-x divide-gray-200 text-xs"
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={selected}
            className={`px-3 py-1.5 ${selected ? SELECTED_CLASS : UNSELECTED_CLASS}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
