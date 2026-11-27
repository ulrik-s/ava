/**
 * Ska ärendet markeras som avslutat? (#2100) — ren logik, ingen I/O.
 *
 * Ett aktivt ärende där ingen tid registrerats på två kalendermånader (svensk
 * tid) får en post i Att åtgärda. Referensen är det senaste av ärendets senaste
 * tidspost, när ärendet skapades och när någon senast valde **Behåll som
 * aktivt**. Posten är härledd som övriga poster i `watchlist.ts`: registrera
 * tid, stäng ärendet eller välj Behåll som aktivt, så försvinner den.
 *
 * Statusen (bara aktiva ärenden) väljs av anroparen; här räknas bara tiden.
 */

import { stepDay } from "./calendar-periods";
import { stockholmDay } from "./stockholm-time";
import type { WatchlistItem } from "./watchlist";

/** Så många kalendermånader utan tid innan frågan ställs. Fast i koden. */
export const CLOSE_SUGGESTION_MONTHS = 2;

type DateInput = Date | string | null | undefined;

/** Ett aktivt ärende som kandidat, strukturellt (ärendets rad + tidsposternas senaste). */
export interface CloseSuggestionCandidate {
  id: string;
  matterNumber: string;
  title: string;
  createdAt?: DateInput;
  /** Senast någon valde Behåll som aktivt (#2098). */
  keptActiveAt?: DateInput;
  /** Det senare av arbetsdatum och registrering för ärendets senaste tidspost. */
  latestEntryAt?: DateInput;
}

function toTime(v: DateInput): number | null {
  if (v === null || v === undefined) return null;
  const t = (v instanceof Date ? v : new Date(v)).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Det senaste av tidspost, skapande och Behåll som aktivt. Null utan någon referens. */
export function closeReference(c: CloseSuggestionCandidate): Date | null {
  const times = [c.latestEntryAt, c.createdAt, c.keptActiveAt]
    .map(toTime)
    .filter((t): t is number => t !== null);
  return times.length === 0 ? null : new Date(Math.max(...times));
}

function closeSuggestionItem(c: CloseSuggestionCandidate, today: string): WatchlistItem | null {
  const ref = closeReference(c);
  if (ref === null) return null;
  const since = stockholmDay(ref);
  // stepDay klipper till månadens sista dag: 2026-12-31 + 2 månader = 2027-02-28.
  if (stepDay(since, "month", CLOSE_SUGGESTION_MONTHS) > today) return null;
  return {
    kind: "closeSuggestion",
    severity: "approaching",
    title: "Ska ärendet markeras som avslutat?",
    detail: `Ingen tid registrerad sedan ${since}.`,
    matterId: c.id, matterNumber: c.matterNumber,
    at: null, amountOre: null,
    link: { route: "matters", id: c.id },
    closeSuggestion: { matterTitle: c.title, noTimeSince: since },
  };
}

/** Poster för de kandidater som stått utan tid i två kalendermånader, högst en per ärende. */
export function closeSuggestionItems(candidates: readonly CloseSuggestionCandidate[], now: Date): WatchlistItem[] {
  const today = stockholmDay(now);
  const seen = new Set<string>();
  const out: WatchlistItem[] = [];
  for (const c of candidates) {
    const item = seen.has(c.id) ? null : closeSuggestionItem(c, today);
    seen.add(c.id);
    if (item !== null) out.push(item);
  }
  return out;
}
