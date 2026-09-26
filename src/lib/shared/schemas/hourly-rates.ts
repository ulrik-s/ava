import { z } from "zod";
import type { HourlyTimeEntryKind } from "./enums";

/** Ett timpris i öre/h, exkl moms. Utelämnat = ärvs från nivån ovanför. */
const rateOreSchema = z.number().int().nonnegative().optional();

/**
 * Timpris per timbaserad kategori (#1206) — samma form på byrå, jurist och
 * ärende (`hourlyRates` på `organizations`, `users`, `matters`). En saknad
 * nyckel betyder "inget eget pris här": resolvern (`resolveHourlyRate`) går då
 * vidare till nästa nivå. Strikt: en okänd nyckel är ett fel, inte en tyst
 * kategori som ingen läser.
 */
export const hourlyRatesSchema = z.object({
  ARBETE: rateOreSchema,
  ARBETE_OBEKVAM_TID: rateOreSchema,
  TIDSSPILLAN: rateOreSchema,
  TIDSSPILLAN_OVRIG_TID: rateOreSchema,
} satisfies Record<HourlyTimeEntryKind, typeof rateOreSchema>).strict();

/** Timpris per timbaserad kategori (öre/h); saknad nyckel = ärvs. */
export type HourlyRates = z.infer<typeof hourlyRatesSchema>;
