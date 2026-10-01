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

/**
 * Indata (#1362): en kalenderdag "YYYY-MM-DD" som finns — 2026-13-45 och
 * 2026-02-30 avvisas. Bara för router-indata; lagrade rader läses med de
 * tillåtande schemana ovan (en strikt läsning tappar rader tyst).
 */
export const isoDayInput = z.iso.date();

/** Indata (#1362): ett klockslag "HH:mm", 00:00–23:59. */
export const clockTimeInput = z.iso.time({ precision: -1 });

/**
 * Indata (#1362): en dag ("YYYY-MM-DD") eller en tidpunkt (ISO 8601, med eller
 * utan tidszon) som går att tolka — aldrig `Invalid Date` i `new Date(...)`.
 */
export const isoDateOrDateTimeInput = z.union([z.iso.date(), z.iso.datetime({ offset: true, local: true })]);

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
