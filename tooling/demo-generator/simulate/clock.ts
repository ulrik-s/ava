/**
 * Deterministisk händelse-klocka för den kronologiska simuleringen (#880).
 *
 * Ett ärende "startar" `startDaysAgo` dagar sedan (ur seedens createdDaysAgo). Ett
 * events datum = ärendestart + `dayOffset` dagar, klampat till ≤ idag (aldrig i
 * framtiden). Enda "nu" är detta `new Date()` — ingen `Math.random`; variation i
 * scenarierna härleds ur ärende-index (determinism krävs av demot + CI).
 */

/** ISO-datum för ett event: ärendestart (startDaysAgo sedan) + dayOffset dagar. */
export function eventIso(startDaysAgo: number, dayOffset: number, hour = 10): string {
  const daysAgo = Math.max(0, startDaysAgo - dayOffset);
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

/** Klockslag (HH:MM) för en tjänsteanteckning, härlett ur timmen. */
export function eventTime(hour = 10): string {
  return `${String(hour).padStart(2, "0")}:00`;
}
