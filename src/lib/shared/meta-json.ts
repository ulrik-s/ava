/**
 * `.ava/meta.json` — zod-validerad läsning av repots schemaVersion (#187).
 *
 * Tre kodvägar läste tidigare meta-filen med `JSON.parse(...) as
 * { schemaVersion?: unknown }` (demo-loader, server-working-copy,
 * load-self-hosted-source). Stilregeln säger zod vid parsegränsen — det här
 * är den delade gränsen.
 *
 * Tolerant per design (ADR 0004): saknad/icke-numerisk version → `undefined`
 * (= v1-baslinje för grinden). Trasig JSON kastar — anroparna behåller sina
 * try/catch eftersom "trasig fil" ska tolkas som baslinje, inte krasch.
 */

import { z } from "zod";

import { parseSchemaVersion } from "./schema-version";

export const metaJsonSchema = z
  .object({ schemaVersion: z.number().int().positive().optional() })
  .passthrough();

/**
 * Läs schemaVersion ur meta.json-TEXT. Zod-validering vid gränsen: fel typ på
 * `schemaVersion` (sträng, negativt, decimal) → `undefined` (v1-baslinje),
 * precis som en saknad nyckel. Ogiltig JSON kastar.
 */
export function schemaVersionFromMetaJson(text: string): number | undefined {
  const parsed = metaJsonSchema.safeParse(JSON.parse(text));
  if (!parsed.success) return undefined;
  return parseSchemaVersion(parsed.data.schemaVersion);
}
