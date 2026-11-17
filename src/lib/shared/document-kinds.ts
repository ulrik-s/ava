/**
 * Dokumentets typer (ADR 0038) — EN mekanism för "vad är det här för dokument?".
 *
 * Ett dokument har en ordnad lista typer (`kinds`, första = primär). Varje typ
 * är en inbyggd kod (`KNOWN_KINDS`) eller en av byråns egna typer
 * (visningsnamnet självt). Här finns de tre reglerna all kod går genom:
 *
 *   - `normalizeKind` — text → typ. Kod, visningsnamn och synonymer blir en
 *     inbyggd kod; allt annat behålls som egen typ. Inget kastas.
 *   - `documentKinds` — läsregeln. `kinds` om de är satta (eller medvetet
 *     tömda), annars härledda ur de äldre fälten `documentType` + `tags` och
 *     delarna (rader skrivna före ADR 0038 eller av äldre klienter).
 *   - `kindsFields` — skrivregeln. Sätter `kinds` + `kindsManual`, speglar
 *     primärtypen i `documentType` (för äldre läsare) och tömmer `tags`.
 *
 * Ren, utan beroenden utöver `document-kind`, så klient och server delar den.
 */

import { type DocumentKind, guessFromFilename, isDocumentKind, KIND_LABELS, KNOWN_KINDS } from "./document-kind";

/** Synonymer som inte är en kod eller ett visningsnamn (gemener). */
const SYNONYMS: Readonly<Record<string, DocumentKind>> = {
  "stämningsansökan": "STAMNING",
  "ansökan om stämning": "STAMNING",
  "dom": "DOM",
  "beslut": "DOM",
  "svaromål": "INLAGA",
  "yttrande": "INLAGA",
  "överklagande": "INLAGA",
  "bevisning": "BEVIS",
  "förundersökningsprotokoll": "FUP",
  "epost": "EPOST",
  "e-mail": "EPOST",
  "email": "EPOST",
  "mejl": "EPOST",
  "oklassificerat": "OKLASSIFICERAT",
};

const key = (text: string): string => text.trim().replace(/\s+/g, " ").toLowerCase();

/** Gemener → inbyggd kod: koderna, visningsnamnen och synonymerna. */
const LOOKUP: ReadonlyMap<string, DocumentKind> = new Map([
  ...KNOWN_KINDS.map((k): [string, DocumentKind] => [key(k), k]),
  ...KNOWN_KINDS.map((k): [string, DocumentKind] => [key(KIND_LABELS[k]), k]),
  ...Object.entries(SYNONYMS),
]);

/**
 * Text → typ: en inbyggd kod om texten är en kod, ett visningsnamn eller en
 * känd synonym; annars texten själv (trimmad) som byråns egen typ. Tomt → null.
 */
export function normalizeKind(text: string | null | undefined): string | null {
  const trimmed = text?.trim().replace(/\s+/g, " ") ?? "";
  if (trimmed === "") return null;
  return LOOKUP.get(key(trimmed)) ?? trimmed;
}

/** Normalisera en lista: inga tomma, inga dubbletter, ordningen behålls. */
export function normalizeKinds(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.map(normalizeKind).filter((k): k is string => k !== null))];
}

/** Det läsregeln behöver ur ett dokument (rad, entitet eller klientcache). */
export interface KindsCarrier {
  kinds?: readonly string[] | null | undefined;
  kindsManual?: boolean | null | undefined;
  /** Föråldrad: Spegel av primärtypen; läses bara för rader från före ADR 0038. */
  documentType?: string | null | undefined;
  /** Föråldrad: Ersatt av typerna; läses bara för rader från före ADR 0038. */
  tags?: readonly string[] | null | undefined;
  /** Delarnas typer (#1220), om de finns till hands. */
  parts?: readonly { kind: string }[] | null | undefined;
}

/** Har dokumentet egna `kinds` (satta, eller medvetet tömda av en person)? */
function hasOwnKinds(d: KindsCarrier): boolean {
  return !!d.kinds && (d.kinds.length > 0 || d.kindsManual === true);
}

/**
 * Har dokumentet typer bara i de äldre fälten (`documentType`/`tags`)? Då ska
 * serverns backfill skriva dem till `kinds` (ADR 0038).
 */
export function needsKindsBackfill(d: KindsCarrier): boolean {
  return !hasOwnKinds(d) && (!!d.documentType || (d.tags?.length ?? 0) > 0);
}

/** Typerna ur de äldre fälten: delarna, `documentType` och taggarna. */
export function legacyKinds(d: KindsCarrier): string[] {
  return normalizeKinds([...(d.parts ?? []).map((p) => p.kind), d.documentType, ...(d.tags ?? [])]);
}

/** Läsregeln: dokumentets typer, primär först. */
export function documentKinds(d: KindsCarrier): string[] {
  return hasOwnKinds(d) ? [...(d.kinds ?? [])] : legacyKinds(d);
}

/** Har dokumentet typen `kind` (läsregeln, även för äldre rader)? */
export function hasKind(d: KindsCarrier, kind: string): boolean {
  return documentKinds(d).includes(kind);
}

/**
 * Fälten en skrivning av typerna sätter (skrivregeln). En typalias (inte ett
 * interface) så att den passar repo-patcharnas indexsignatur.
 */
export type KindsFields = {
  kinds: string[];
  kindsManual: boolean;
  /** Spegel av primärtypen för äldre läsare (ADR 0038, utfasas). */
  documentType: string | null;
  /** Tömda: taggarna har flyttat in bland typerna. */
  tags: string[];
};

/** Skrivregeln: normaliserade typer + vem som satt dem. */
export function kindsFields(kinds: readonly (string | null | undefined)[], manual: boolean): KindsFields {
  const normalized = normalizeKinds(kinds);
  return { kinds: normalized, kindsManual: manual, documentType: normalized[0] ?? null, tags: [] };
}

/** Samma typer (oavsett ordning)? */
export function sameKinds(a: readonly string[], b: readonly string[]): boolean {
  const set = new Set(a);
  return a.length === b.length && b.every((k) => set.has(k));
}

/** Är typen en av byråns egna (inte inbyggd)? */
export function isCustomKind(kind: string): boolean {
  return !isDocumentKind(kind);
}

/** Det `legacyKindsManual` behöver ur en äldre rad. */
export interface LegacyManualCarrier {
  documentType?: string | null | undefined;
  fileName?: string | undefined;
  analysisModel?: string | null | undefined;
  /** Delarna i sidordning (#1220). */
  parts?: readonly { source?: string }[] | null | undefined;
}

/** En kod som användaren satte före delarna: aldrig analyserad, och inte filnamnets gissning. */
function userSetCode(d: LegacyManualCarrier): boolean {
  if (!d.documentType || d.analysisModel || !d.fileName) return false;
  return d.documentType !== guessFromFilename(d.fileName);
}

/**
 * Satte en person (eller systemet) typen i de äldre fälten? Specialvärden
 * (Kostnadsräkning, E-post, fritext) klassades aldrig om, en manuell första
 * del (#1220) är användarens rättelse, och en kod som användaren satte före
 * delarna räknas också. Då ska AI:n inte ändra typerna efter flytten.
 */
export function legacyKindsManual(d: LegacyManualCarrier): boolean {
  if (d.documentType && !isDocumentKind(d.documentType)) return true;
  return d.parts?.[0]?.source === "MANUAL" || userSetCode(d);
}

/**
 * Får AI:n sätta dokumentets typer? Nej om en person eller systemet satt dem
 * (`kindsManual`), eller — för en rad som inte flyttats än — om de äldre
 * fälten var satta för hand (`legacyKindsManual`).
 */
export function kindsAreManual(d: KindsCarrier & LegacyManualCarrier): boolean {
  if (d.kindsManual === true) return true;
  return needsKindsBackfill(d) && legacyKindsManual({ documentType: d.documentType, fileName: d.fileName, analysisModel: d.analysisModel });
}

/** Det `organizationKinds` behöver ur byrån. */
export interface OrganizationKindsCarrier {
  documentKinds?: readonly string[] | null | undefined;
  /** Föråldrad: Taggvokabulären (#621); läses bara innan byrån flyttats. */
  documentTags?: readonly string[] | null | undefined;
}

/**
 * Byråns egna typer (läsregeln för byrån): `documentKinds`, eller — innan
 * backfillen flyttat dem — taggvokabulärens värden som inte är inbyggda typer.
 */
export function organizationKinds(org: OrganizationKindsCarrier | null | undefined): string[] {
  if (org?.documentKinds && org.documentKinds.length > 0) return [...org.documentKinds];
  return normalizeKinds(org?.documentTags ?? []).filter(isCustomKind);
}
