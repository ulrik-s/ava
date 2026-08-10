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
  const now = new Date();
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  // Dag-klampningen ovan räcker inte: `hour` sätts EFTERÅT, så ett event i ett
  // färskt ärende landade på "idag kl 11" även när bygget kördes kl 06 — en
  // betalning eller avskrivning daterad i framtiden. Klampa hela tidpunkten.
  return (d > now ? now : d).toISOString();
}

/** Klockslag (HH:MM) för en tjänsteanteckning, härlett ur timmen. */
export function eventTime(hour = 10): string {
  return `${String(hour).padStart(2, "0")}:00`;
}
