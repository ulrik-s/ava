/**
 * `deadlineColor` — ren, ramverks-agnostisk färgkodning av en uppgifts
 * återstående tid till sin deadline (#88).
 *
 * Färgskala (baserat på `dueAt - now`):
 *   - **grön:**  ≥ 7 dagar kvar
 *   - **gul:**   2–7 dagar kvar (`2d ≤ kvar < 7d`)
 *   - **röd:**   < 2 dagar kvar — inklusive **förfallen** (kvar < 0)
 *   - **null (neutral):** ingen `dueAt`, eller uppgiften är klar (DONE)
 *
 * Gränsfallen är låsta med `<`: exakt 7 dygn → grön, exakt 2 dygn → gul.
 * Bor i `shared/` (ingen UI-/server-koppling) så den kan enhetstestas
 * isolerat och återanvändas av både todo-vyn och ev. dashboard-widgets.
 */

export type DeadlineColor = "green" | "yellow" | "red";

const DAY_MS = 86_400_000;
const RED_WITHIN_MS = 2 * DAY_MS;
const YELLOW_WITHIN_MS = 7 * DAY_MS;

export interface DeadlineColorOpts {
  /** Klar uppgift (status DONE) → ingen färg. */
  done?: boolean;
}

/** Tolka `dueAt` → giltig epoch-ms, eller `null` (saknad/ogiltig). */
function toValidMs(dueAt: Date | string | null | undefined): number | null {
  if (dueAt == null || dueAt === "") return null;
  const ms = (dueAt instanceof Date ? dueAt : new Date(dueAt)).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Returnera deadline-färgen för `dueAt` relativt `now`, eller `null` när
 * ingen färg ska visas (saknad deadline eller klar uppgift).
 */
export function deadlineColor(
  dueAt: Date | string | null | undefined,
  now: Date,
  opts: DeadlineColorOpts = {},
): DeadlineColor | null {
  if (opts.done) return null;
  const ms = toValidMs(dueAt);
  if (ms === null) return null;

  const remaining = ms - now.getTime();
  if (remaining < RED_WITHIN_MS) return "red"; // < 2 dygn, inkl. förfallen
  if (remaining < YELLOW_WITHIN_MS) return "yellow"; // 2–7 dygn
  return "green"; // ≥ 7 dygn
}
