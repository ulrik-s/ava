/**
 * Fält som bara servern skriver (#1280) — en radpush får inte återställa dem.
 *
 * Radkön pushar hela raden. Ett dokument som klienten byter namn på innan den
 * hunnit pulla serverns klassning bär då sina gamla `documentType: null` och
 * `analysisStatus: PENDING` — och skulle skriva över klassningen.
 *
 *   - Analysfälten (`analyzedAt`, `analysisStatus`, …) skrivs bara av serverns
 *     jobb och tas alltid bort ur en radpush.
 *   - Klassningen (`documentType`, `tags`, `summary`) kan också användaren
 *     ändra. Den tas bort bara när klienten inte har sett serverns senaste
 *     analys (radens `analyzedAt` skiljer sig från serverns) — då är klientens
 *     värden inaktuella, inte ett medvetet val.
 */

import { comparable } from "./push-guard";

type Row = Record<string, unknown>;

const ANALYSIS_FIELDS: readonly string[] = ["analyzedAt", "analysisStatus", "analysisModel", "analysisError"];
const CLASSIFICATION_FIELDS: readonly string[] = ["documentType", "tags", "summary"];

function without(row: Row, fields: readonly string[]): Row {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !fields.includes(k)));
}

/** Har klienten inte sett serverns senaste analys? */
function missedAnalysis(existing: Row, incoming: Row): boolean {
  return existing.analyzedAt != null && comparable(existing.analyzedAt) !== comparable(incoming.analyzedAt);
}

/** Radens patch utan de fält servern äger (bara dokument berörs). */
export function withoutServerOwned(entity: string, existing: Row, incoming: Row): Row {
  if (entity !== "document") return incoming;
  const stale = missedAnalysis(existing, incoming);
  const patch = without(incoming, ANALYSIS_FIELDS);
  return stale ? without(patch, CLASSIFICATION_FIELDS) : patch;
}
