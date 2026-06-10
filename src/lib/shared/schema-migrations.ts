/**
 * Migrate-on-read ([ADR 0004]) — lyfter rå-rader från ett äldre repos
 * `schemaVersion` upp till {@link CURRENT_SCHEMA_VERSION} INNAN zod-parsern
 * ser dem. Körs i hydreringsvägen (både `ProjectionHydrator` och
 * `hydrateWorkingCopy`), efter att versionsgrinden släppt igenom repot.
 *
 * Varför migrate-on-READ (inte on-clone): den append-only event-loggen skrivs
 * aldrig om, så historiska rader måste kunna läsas i gammalt format för alltid.
 *
 * Att lägga till en migration:
 *   1. Bumpa `CURRENT_SCHEMA_VERSION` (N → N+1) i `schema-version.ts`.
 *   2. Lägg en post `MIGRATIONS[entity][N]` som lyfter EN rad ett steg (N→N+1).
 *   3. Kedjan körs automatiskt (v1→v2→v3…) för repon som ligger flera steg bak.
 *
 * [ADR 0004]: ../../../docs/adr/0004-schemaversion-och-versionsgrind.md
 */
import { z } from "zod";
import { CURRENT_SCHEMA_VERSION } from "./schema-version";

/** Lyfter en rå rad exakt ETT versionssteg (from → from+1). Ren funktion. */
export type RowMigration = (row: Record<string, unknown>) => Record<string, unknown>;

/**
 * `MIGRATIONS[entity][n]` lyfter en `entity`-rad från schemaVersion `n` till
 * `n+1`. Saknad post → identitet (entiteten ändrades inte i det steget).
 */
const MIGRATIONS: Record<string, Record<number, RowMigration>> = {
  // invoice v1 → v2: ta bort det döda legacy-aliaset `type`. Fältet döptes om
  // till `invoiceType` (routrar + UI använder uteslutande `invoiceType`); `type`
  // skrevs bara av seed:en och lästes av ingen. Migrationen avlägsnar det så att
  // projection-schemat kan sluta tolerera det (eliminerar en `.passthrough()`-
  // workaround, jfr ADR 0004 §"bump-policy").
  invoice: {
    1: ({ type: _legacyType, ...rest }) => rest,
  },
};

/**
 * Kedja en rå rad från `fromVersion` upp till `toVersion`. Rör inte raden om
 * den redan är aktuell (from === to) eller saknar migrationer för stegen.
 */
export function migrateRow(
  entity: string,
  row: Record<string, unknown>,
  fromVersion: number,
  toVersion: number = CURRENT_SCHEMA_VERSION,
): Record<string, unknown> {
  let current = row;
  for (let v = fromVersion; v < toVersion; v++) {
    const step = MIGRATIONS[entity]?.[v];
    if (step) current = step(current);
  }
  return current;
}

/**
 * Sträng-wrappern som hydratorn använder: parsa, migrera (om det är ett
 * objekt), och re-serialisera. Trasig JSON / icke-objekt returneras oförändrat
 * så att den nedströms deserialize:n kastar precis som förr.
 */
export function migrateRawJson(
  entity: string,
  raw: string,
  fromVersion: number,
  toVersion: number = CURRENT_SCHEMA_VERSION,
): string {
  if (fromVersion >= toVersion) return raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  // Zod vid parsegränsen (#187); array-guard kvar (record accepterar inte arrays semantiskt här).
  if (Array.isArray(parsed)) return raw;
  const obj = z.record(z.string(), z.unknown()).safeParse(parsed);
  if (!obj.success) return raw;
  const migrated = migrateRow(entity, obj.data, fromVersion, toVersion);
  return JSON.stringify(migrated);
}

// ── Event-payloads (#58) ─────────────────────────────────────────────────────
// Den append-only event-loggen skrivs ALDRIG om, så historiska payloads ligger
// kvar i sitt ursprungsformat för evigt. Migrate-on-read normaliserar dem vid
// läsning (FilesystemEventLog → EventLogProjection), keyat på event-typ + version.
// Payloads är fria `z.record` → migrationen kan köra EFTER zod-parse (parse
// avvisar aldrig payload-form), till skillnad från entiteterna ovan.

/** Lyfter en event-payload exakt ETT versionssteg för en given event-typ. */
export type EventPayloadMigration = (payload: Record<string, unknown>) => Record<string, unknown>;

/** Byt legacy-`type` → `invoiceType` om den finns (jfr entitets-migrationen i
 *  v1→v2, PR #57). No-op när `type` saknas eller `invoiceType` redan finns. */
function renameInvoiceType(payload: Record<string, unknown>): Record<string, unknown> {
  if (!("type" in payload) || "invoiceType" in payload) return payload;
  const { type, ...rest } = payload;
  return { ...rest, invoiceType: type };
}

/** `EVENT_MIGRATIONS[type][n]` lyfter en payload för `type` från v`n` → v`n+1`. */
const EVENT_MIGRATIONS: Record<string, Record<number, EventPayloadMigration>> = {
  "invoice.created": { 1: renameInvoiceType },
  "invoice.sent": { 1: renameInvoiceType },
};

/**
 * Kedja en event-payload (för `eventType`) från `fromVersion` upp till
 * `toVersion`. Ren funktion; saknad post → identitet.
 */
export function migrateEventPayload(
  eventType: string,
  payload: Record<string, unknown>,
  fromVersion: number,
  toVersion: number = CURRENT_SCHEMA_VERSION,
): Record<string, unknown> {
  let current = payload;
  for (let v = fromVersion; v < toVersion; v++) {
    const step = EVENT_MIGRATIONS[eventType]?.[v];
    if (step) current = step(current);
  }
  return current;
}
