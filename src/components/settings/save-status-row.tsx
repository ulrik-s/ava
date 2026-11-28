/**
 * `SaveStatusRow` — knappen Spara och statusen bredvid den för inställningar som
 * sparas med en knapp i stället för formulärets debounce (Frister #1912,
 * betalningsvillkoret #2265): Sparar…, Sparat ✓, ett eget valideringsfel eller
 * serverns fel.
 */

/** Det raden visar; `null` = inget fel. */
export interface SaveStatusRowProps {
  onSave: () => void;
  pending: boolean;
  saved: boolean;
  /** Egen validering (sparas inte), t.ex. "Värdet är för stort". */
  invalid: string | null;
  /** Serverns felmeddelande. */
  error: string | null;
}

/** Spara-knappen med status. */
export function SaveStatusRow({ onSave, pending, saved, invalid, error }: SaveStatusRowProps) {
  return (
    <div className="mt-2 flex items-center gap-3">
      <button type="button" onClick={onSave} disabled={pending}
        className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
        Spara
      </button>
      {pending && <span className="text-xs text-gray-500">Sparar…</span>}
      {saved && <span className="text-xs text-green-600">Sparat ✓</span>}
      {invalid && <span className="text-xs text-red-600">{invalid}</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
