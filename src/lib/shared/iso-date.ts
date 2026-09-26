/**
 * `YYYY-MM-DD` i LOKAL tid.
 *
 * Fanns i tre privata kopior (kostnadsräkningen, Fortnox-renderaren,
 * bokföringsfönstret). Lokal tid — inte `toISOString()` — är medvetet: ett
 * verifikat daterat 2026-01-01 kl. 00:30 svensk tid ska bokföras på den
 * 1 januari, inte den 31 december som UTC-varianten hade gett.
 */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** `YYYY-MM-DD` (lokal tid) ur ett `Date` eller en datumsträng. */
export function toIsoDate(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

/** `HH:MM` (lokal tid) — klockslaget i en förhandling eller ett förhör. */
export function toLocalTime(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
}

const SV_MONTHS = [
  "januari", "februari", "mars", "april", "maj", "juni",
  "juli", "augusti", "september", "oktober", "november", "december",
] as const;

/** `"24 september 2026"` (lokal tid) — datum i ord, som i ett brev (#1218). */
export function toSwedishLongDate(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return `${dt.getDate()} ${SV_MONTHS[dt.getMonth()] ?? ""} ${dt.getFullYear()}`;
}
