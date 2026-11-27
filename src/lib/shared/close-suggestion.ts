/**
 * Ska ärendet markeras som avslutat? (#2100) — ren logik, ingen I/O.
 *
 * Ett aktivt ärende där ingen tid registrerats på två kalendermånader (svensk
 * tid) får en post i Att åtgärda. Referensen är det senaste av ärendets senaste
 * tidspost, när ärendet skapades och när någon senast valde **Behåll som
 * aktivt**. Posten är härledd som övriga poster i `watchlist.ts`: registrera
 * tid, stäng ärendet eller välj Behåll som aktivt, så försvinner den.
 *
 * Regel 2 (#2101): ett dokument som ser ut att vara ett slutligt avgörande
 * (`finalRuling`, #2099) ger också ett skäl, om det lades in efter det senaste
 * Behåll som aktivt (eller om ärendet aldrig fått det). Slår båda reglerna till
 * blir det EN post: tidsskälet först, sedan dokumenten i den ordning de lades in.
 *
 * Statusen (bara aktiva ärenden) väljs av anroparen; här räknas bara skälen.
 */

import { stepDay } from "./calendar-periods";
import type { FinalRuling } from "./schemas/document";
import { stockholmDay } from "./stockholm-time";
import type { CloseSuggestionDocument, WatchlistItem } from "./watchlist";

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
  /** Ärendets dokument som ser ut att vara ett slutligt avgörande (#2101). */
  finalRulings?: readonly FinalRulingCandidate[];
}

/** Ett dokument med ett slutligt avgörande, strukturellt (repots `FinalRulingDocument`). */
export interface FinalRulingCandidate {
  id: string;
  fileName: string;
  storagePath: string;
  createdAt: DateInput;
  finalRuling: FinalRuling;
}

/** Vad dokumentet ser ut att vara, efter "<filnamn> ser ut att vara …". */
const RULING_TEXT: Record<FinalRuling, string> = {
  AVSKRIVNING: "ett slutligt beslut om avskrivning",
  DOM_HD: "en dom från Högsta domstolen",
  DOM_HFD: "en dom från Högsta förvaltningsdomstolen",
  PT_HD: "ett beslut från Högsta domstolen att inte meddela prövningstillstånd",
  PT_HFD: "ett beslut från Högsta förvaltningsdomstolen att inte meddela prövningstillstånd",
};

/** Skälet utan filnamnet: "ser ut att vara en dom från Högsta domstolen." */
export function finalRulingReason(ruling: FinalRuling): string {
  return `ser ut att vara ${RULING_TEXT[ruling]}.`;
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

/** Dagen sedan dess ingen tid registrerats, när det gått två kalendermånader; annars null. */
function noTimeSince(c: CloseSuggestionCandidate, today: string): string | null {
  const ref = closeReference(c);
  if (ref === null) return null;
  const since = stockholmDay(ref);
  // stepDay klipper till månadens sista dag: 2026-12-31 + 2 månader = 2027-02-28.
  return stepDay(since, "month", CLOSE_SUGGESTION_MONTHS) > today ? null : since;
}

/**
 * Dokumenten som ger ett skäl (#2101): inlagda efter det senaste Behåll som
 * aktivt, eller alla utan det, i den ordning de lades in.
 */
function rulingDocuments(c: CloseSuggestionCandidate): CloseSuggestionDocument[] {
  const kept = toTime(c.keptActiveAt);
  return (c.finalRulings ?? [])
    .map((d) => ({ d, at: toTime(d.createdAt) ?? 0 }))
    .filter(({ at }) => kept === null || at > kept)
    .sort((a, b) => a.at - b.at)
    .map(({ d }) => ({ id: d.id, fileName: d.fileName, storagePath: d.storagePath, ruling: d.finalRuling }));
}

/** Tidsskälet: "Ingen tid registrerad sedan 2026-09-25." */
export function noTimeReason(since: string): string {
  return `Ingen tid registrerad sedan ${since}.`;
}

/** Alla skäl i en rad (CLI och MCP): tidsskälet först, sedan dokumenten. */
function closeDetail(since: string | null, documents: readonly CloseSuggestionDocument[]): string {
  const time = since === null ? [] : [noTimeReason(since)];
  return [...time, ...documents.map((d) => `${d.fileName} ${finalRulingReason(d.ruling)}`)].join(" ");
}

function closeSuggestionItem(c: CloseSuggestionCandidate, today: string): WatchlistItem | null {
  const since = noTimeSince(c, today);
  const documents = rulingDocuments(c);
  if (since === null && documents.length === 0) return null;
  return {
    kind: "closeSuggestion",
    severity: "approaching",
    title: "Ska ärendet markeras som avslutat?",
    detail: closeDetail(since, documents),
    matterId: c.id, matterNumber: c.matterNumber,
    at: null, amountOre: null,
    link: { route: "matters", id: c.id },
    closeSuggestion: { matterTitle: c.title, noTimeSince: since, documents },
  };
}

/** Poster för de kandidater som stått utan tid i två kalendermånader eller fått ett slutligt avgörande, högst en per ärende. */
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
