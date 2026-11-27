/**
 * Fält som bara servern skriver (#1280) — en radpush får inte återställa dem.
 *
 * Radkön pushar hela raden. Ett dokument som klienten byter namn på innan den
 * hunnit pulla serverns klassning bär då sina gamla `documentType: null` och
 * `analysisStatus: PENDING` — och skulle skriva över klassningen.
 *
 *   - Analysfälten (`analyzedAt`, `analysisStatus`, …) skrivs bara av serverns
 *     jobb och tas alltid bort ur en radpush.
 *   - Klassningen (`kinds`, `kindsManual`, `summary` och de äldre
 *     `documentType`/`tags`) kan också användaren ändra. Den tas bort bara när
 *     klienten inte har sett serverns senaste analys (radens `analyzedAt`
 *     skiljer sig från serverns) — då är klientens värden inaktuella, inte ett
 *     medvetet val.
 *
 *   - Det slutliga avgörandet (`finalRuling`, #2099) töms aldrig av servern.
 *     Ett tomt värde i en radpush är därför alltid inaktuellt (t.ex. från en
 *     klient som döpt om dokumentet innan den hämtat jobbets resultat) och tas
 *     bort. Ett satt värde tas emot: i FSA-vägen har bara klienten texten.
 *
 * Äldre klienter (ADR 0038) pushar rader utan `kinds`, med typerna i
 * `documentType`/`tags`. `withKindsFromLegacy` översätter dem: oförändrade
 * äldre fält tas bort (typerna står kvar), ändrade blir nya typer.
 */

import {
  documentKinds, kindsFields, legacyKinds, legacyKindsManual, sameKinds,
} from "@/lib/shared/document-kinds";
import { comparable } from "./push-guard";

type Row = Record<string, unknown>;

const ANALYSIS_FIELDS: readonly string[] = ["analyzedAt", "analysisStatus", "analysisModel", "analysisError"];
const CLASSIFICATION_FIELDS: readonly string[] = ["kinds", "kindsManual", "documentType", "tags", "summary"];
const LEGACY_KIND_FIELDS: readonly string[] = ["documentType", "tags"];

function without(row: Row, fields: readonly string[]): Row {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !fields.includes(k)));
}

/** Ett tomt `finalRuling` i en push är inaktuellt — fältet töms aldrig (#2099). */
function withoutEmptyFinalRuling(row: Row): Row {
  return "finalRuling" in row && row.finalRuling == null ? without(row, ["finalRuling"]) : row;
}

/** Har klienten inte sett serverns senaste analys? */
function missedAnalysis(existing: Row, incoming: Row): boolean {
  return existing.analyzedAt != null && comparable(existing.analyzedAt) !== comparable(incoming.analyzedAt);
}

/** Radens patch utan de fält servern äger (bara dokument berörs). */
export function withoutServerOwned(entity: string, existing: Row, incoming: Row): Row {
  if (entity !== "document") return incoming;
  const stale = missedAnalysis(existing, incoming);
  const patch = withoutEmptyFinalRuling(without(incoming, ANALYSIS_FIELDS));
  return stale ? without(patch, CLASSIFICATION_FIELDS) : patch;
}

/** Samma äldre fält som serverns rad (klienten har inte rört typerna)? */
function legacyUnchanged(existing: Row, incoming: Row): boolean {
  const sameType = (incoming.documentType ?? null) === (existing.documentType ?? null);
  return sameType && JSON.stringify(incoming.tags ?? []) === JSON.stringify(existing.tags ?? []);
}

/**
 * En dokumentrad från en äldre klient (utan `kinds`) → med typerna (ADR 0038).
 * Rader med `kinds`, andra entiteter och rader utan äldre fält passerar orörda.
 */
export function withKindsFromLegacy(entity: string, existing: Row | null, incoming: Row): Row {
  if (entity !== "document" || "kinds" in incoming || !LEGACY_KIND_FIELDS.some((f) => f in incoming)) return incoming;
  const legacy = legacyKinds(incoming);
  const rest = without(incoming, LEGACY_KIND_FIELDS);
  if (existing && (legacyUnchanged(existing, incoming) || sameKinds(legacy, documentKinds(existing)))) return rest;
  const manual = existing ? existing.kindsManual === true : legacyKindsManual(incoming);
  return { ...rest, ...kindsFields(legacy, manual) };
}
