import { z } from "zod";
import { baseFields, dateLike } from "./common";
import { serviceNoteIdSchema, matterIdSchema, userIdSchema, organizationIdSchema } from "./ids";

/**
 * `ServiceNote` — tjänsteanteckning i ett ärende (#348). En kort, daterad
 * notering om vad som hänt (samtal, åtgärd, övervägande), skild från tidsposter
 * (arvode) och dokument.
 *
 * Append-only i v1 (juridisk spårbarhet) — ingen update/delete via routern.
 * Lagras flat under `service-notes/<id>.json`. `authorId` = principalen som
 * skapade noteringen (sätts av routern, ej editerbart i UI:t).
 *
 * `date` + `time`: separata fält enligt issue:t — `date` är dagen noteringen
 * avser (YYYY-MM-DD), `time` klockslaget (HH:mm). Båda strängar så de inte
 * tidszons-skiftas vid serialisering.
 */
export const serviceNoteSchema = z.object({
  ...baseFields,
  id: serviceNoteIdSchema,
  organizationId: organizationIdSchema,
  matterId: matterIdSchema,
  /** Författare (principal som skapade noteringen). */
  authorId: userIdSchema,
  /** Datum noteringen avser, "YYYY-MM-DD". */
  date: z.string().min(1),
  /** Klockslag, "HH:mm". */
  time: z.string().min(1),
  /** Fritext. */
  text: z.string().min(1),
  createdAt: dateLike,
  updatedAt: dateLike,
}).passthrough();

export type ServiceNote = z.infer<typeof serviceNoteSchema>;
