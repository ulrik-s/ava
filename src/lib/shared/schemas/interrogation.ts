import { z } from "zod";
import { dateLike, orgScopedFields } from "./common";
import { interrogationIdSchema, matterIdSchema } from "./ids";

/** En tidpunkt med tidszon (ISO 8601), som i `schemas/common.ts`. */
const instant = z.iso.datetime({ offset: true });

/** Ett uppehåll i ett förhör: början och slut (ISO-tidpunkter). Som domänens `ForhorPaus`. */
export const interrogationPauseSchema = z.object({ start: instant, end: instant });
export type InterrogationPause = z.infer<typeof interrogationPauseSchema>;

/**
 * Ett förhörs tider (#1855) i formen domänens `Forhor` (`forordnandetaxa.ts`)
 * har: `start`, `end` och `pauses`. Indata till `interrogation.create/update`.
 */
export const interrogationTimesSchema = z.object({
  start: instant,
  end: instant,
  pauses: z.array(interrogationPauseSchema).default([]),
});
export type InterrogationTimes = z.infer<typeof interrogationTimesSchema>;

/**
 * `Interrogation` — ett förhör under förundersökningen i ett förordnandemål
 * (#1855, DVFS 2025:5). Fälten heter som domänens `Forhor`, så att en rad kan
 * skickas rakt in i `BuildInput.forordnande.forhor`. Org-scopad och kopplad
 * till ärendet; procedurägd (ADR 0037) eftersom förhören styr ett belopp.
 *
 * `start`/`end` lagras som `timestamptz` och läses som datum eller sträng
 * (`dateLike`, som övriga tidpunkter på raden); uppehållen ligger i jsonb som
 * ISO-strängar.
 */
export const interrogationSchema = z.object({
  ...orgScopedFields,
  id: interrogationIdSchema,
  matterId: matterIdSchema,
  /** Förhörets början. */
  start: dateLike,
  /** Förhörets slut (efter början). */
  end: dateLike,
  /** Uppehållen, inom förhöret och utan överlapp. */
  pauses: z.array(interrogationPauseSchema).default([]),
}).loose();

export type Interrogation = z.infer<typeof interrogationSchema>;
