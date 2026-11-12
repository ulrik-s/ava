/**
 * Tillåtna tidsvärden (#1544): tid registreras i 6-minutersintervall plus
 * kvartar — hela timmar plus decimalerna ,1 ,2 ,25 ,3 ,4 ,5 ,6 ,7 ,75 ,8 ,9.
 * Regeln, tolkningen av inmatad text och avrundningen finns här, så att
 * klienten och servern delar EN implementation. Lagringen är minuter (heltal).
 */

/** Tillåtna minuter efter hela timmen (,1 = 6 min … ,75 = 45 min … ,9 = 54 min). */
export const ALLOWED_MINUTES_PAST_HOUR: readonly number[] = [0, 6, 12, 15, 18, 24, 30, 36, 42, 45, 48, 54];

const ALLOWED = new Set(ALLOWED_MINUTES_PAST_HOUR);

/** Gemensamt felmeddelande för ett otillåtet tidsvärde (klient och server). */
export const TIME_NOT_ALLOWED_MESSAGE =
  "Tiden måste vara hela timmar eller ha decimalerna ,1 ,2 ,25 ,3 ,4 ,5 ,6 ,7 ,75 ,8 eller ,9. Ändra värdet.";

/** Felmeddelande när texten inte är ett tal i timmar. */
export const TIME_NOT_A_NUMBER_MESSAGE = "Ange tiden i timmar, t.ex. 1,5. Ändra värdet.";

/** Sant när `minutes` är ett tillåtet tidsvärde (heltal ≥ 0 på rutnätet). */
export function isAllowedMinutes(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes >= 0 && ALLOWED.has(minutes % 60);
}

/** Resultatet av att tolka inmatad text i timmar. */
export type ParsedHours =
  | { readonly ok: true; readonly minutes: number }
  | { readonly ok: false; readonly error: string };

const HOURS_TEXT = /^\d+(\.\d+)?$/;

/**
 * Text i timmar → minuter. Komma och punkt är decimaltecken och mellanslag
 * ignoreras ("1,5" och "1.5" → 90). Ett otillåtet värde eller ogiltig text
 * ger ett fel på svenska — aldrig en tyst avrundning.
 */
export function parseHoursToMinutes(raw: string): ParsedHours {
  const text = raw.replace(/\s/g, "").replace(",", ".");
  if (!HOURS_TEXT.test(text)) return { ok: false, error: TIME_NOT_A_NUMBER_MESSAGE };
  const exact = Number(text) * 60;
  const minutes = Math.round(exact);
  // Flyttalsbrus (1.1 * 60 = 66.00000000000001) räknas inte som en bråkdel.
  if (Math.abs(exact - minutes) > 1e-9 || !isAllowedMinutes(minutes)) {
    return { ok: false, error: TIME_NOT_ALLOWED_MESSAGE };
  }
  return { ok: true, minutes };
}

/**
 * Närmaste tillåtna värde (engångsomräkningen och tester). Lika avstånd
 * avrundas uppåt (9 → 12), och tid över 0 blir aldrig 0 utan minst 6 (0,1 h).
 */
export function roundToAllowedMinutes(minutes: number): number {
  if (minutes <= 0) return 0;
  const hourStart = Math.floor(minutes / 60) * 60;
  const candidates = [...ALLOWED_MINUTES_PAST_HOUR.map((m) => hourStart + m), hourStart + 60];
  const nearest = candidates.reduce((best, c) => (Math.abs(c - minutes) <= Math.abs(best - minutes) ? c : best));
  return Math.max(nearest, 6);
}
