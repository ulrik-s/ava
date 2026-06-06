/**
 * Återanvändbara Zod-byggstenar för git-db-entiteter.
 *
 * Konvention: alla rader har minst `id`, `createdAt`, `updatedAt`.
 * Date-fält kan vara serialiserade som ISO-strängar eller Date-instanser
 * (hydrate-working-copy:s reviver konverterar — men vi accepterar båda för
 * robusthet).
 */

import { z } from "zod";
import { organizationIdSchema } from "./ids";

/** ISO 8601-sträng eller Date — JSON.parse kan ge endera. */
export const dateLike = z.union([z.date(), z.string()]).transform((v) => (v instanceof Date ? v : new Date(v)));

/** Optional date (null/undefined OK). */
export const optionalDateLike = dateLike.nullish();

/** cuid()-style sträng eller annan opaque ID. Inte UUID-strikt — godtar valfri non-empty. */
export const idSchema = z.string().min(1);

/**
 * Bas-fält som finns på varje rad i git-db:n.
 *
 * `id` är medvetet det generiska `idSchema` (obrandat) här — varje entitet
 * overridar det med sitt egna branded id-schema (`matterIdSchema`, …) så att
 * `Matter["id"]` blir `MatterId`. Se [[ids]].
 */
export const baseFields = {
  id: idSchema,
  createdAt: dateLike,
  updatedAt: dateLike,
} as const;

/** För entiteter som scopas till en organisation. */
export const orgScopedFields = {
  ...baseFields,
  organizationId: organizationIdSchema,
} as const;
