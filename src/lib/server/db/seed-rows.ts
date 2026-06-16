/**
 * Seed-väg (ADR 0019, #408) — normaliserar en domän-rad (ur `buildSeed()`) till
 * en DB-insertbar rad: defaultar `version`, coercar datum (dateLike → Date) och
 * sätter `deletedAt`. Den faktiska inserten mot Postgres wires server-side i #410
 * (kräver anslutning); detta är den rena, testbara mappningen.
 */

export function coerceDate(v: unknown): Date | null {
  if (v == null) return null;
  return v instanceof Date ? v : new Date(v as string);
}

export interface PreparedRow extends Record<string, unknown> {
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/**
 * Förbered bas-kolumnerna (id behålls; version/created/updated/deleted
 * normaliseras). Domänfält passerar oförändrade — per-tabell-datumcoercion av
 * domänfält (t.ex. lastLoginAt) sker vid insert-wiringen i #410.
 */
export function prepareSeedRow(row: Record<string, unknown>, now: Date): PreparedRow {
  const createdAt = coerceDate(row.createdAt) ?? now;
  return {
    ...row,
    version: typeof row.version === "number" ? row.version : 1,
    createdAt,
    updatedAt: coerceDate(row.updatedAt) ?? createdAt,
    deletedAt: coerceDate(row.deletedAt),
  };
}
