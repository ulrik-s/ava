/**
 * `IdTranslator` — översätter slug-style seed-IDs till deterministiska
 * UUIDv5 innan demo-generatorn skickar dem till tRPC-mutations.
 *
 * Designprincip (ADR 0003 + backend-agnosticitet):
 *   - Demo-data SKA passera samma API som en riktig användare → API:t
 *     genererar / accepterar UUID, inte slugs.
 *   - För determinism (samma demo-bygge → samma UUID) genererar vi
 *     uuidv5(slug, AVA_NAMESPACE) — alla cross-refs härleds via samma
 *     map så de matchar.
 *   - Idempotent: redan-UUID input passerar oförändrad → enklare att
 *     kalla translateIds på allt utan att tänka.
 */
import { isUuid } from "../../src/lib/shared/uuid";
import { uuidv5, AVA_NAMESPACE } from "../../src/lib/shared/uuid-derive";

export interface IdTranslator {
  /** slug → uuid (deterministisk). UUID in → UUID ut. */
  toUuid(input: string): string;
  /** Reverse-lookup för meta.json-publicering. */
  slugFor(uuid: string): string | undefined;
}

export function createIdTranslator(): IdTranslator {
  const slugToUuid = new Map<string, string>();
  const uuidToSlug = new Map<string, string>();

  function toUuid(input: string): string {
    if (isUuid(input)) return input;
    const cached = slugToUuid.get(input);
    if (cached) return cached;
    const uuid = uuidv5(input, AVA_NAMESPACE);
    slugToUuid.set(input, uuid);
    uuidToSlug.set(uuid, input);
    return uuid;
  }

  return {
    toUuid,
    slugFor: (uuid: string) => uuidToSlug.get(uuid),
  };
}

type Row = Record<string, unknown>;

function isIdField(key: string): boolean {
  return key === "id" || key.endsWith("Id");
}

/**
 * Skriv om alla Id-fält i en post genom translator:n. Andra fält är
 * orörda. Tål null/undefined/icke-strängar — bara strängvärden mappas.
 */
export function translateIds(row: Row, t: IdTranslator): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (isIdField(key) && typeof value === "string" && value !== "") {
      out[key] = t.toUuid(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Översätt alla Id-fält i alla rader av ett seed-dataset. Hela datasetet
 * blir UUID-baserat → downstream populate-funktioner ser UUID:n både i
 * primärnyckel och cross-refs, precis som prod-data.
 */
export function translateSeed<T extends object>(seed: T, t: IdTranslator): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(seed as Record<string, unknown>)) {
    out[key] = Array.isArray(value)
      ? value.map((row) => (row && typeof row === "object" ? translateIds(row as Row, t) : row))
      : value;
  }
  return out as T;
}
