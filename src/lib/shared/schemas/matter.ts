import { z } from "zod";
import { orgScopedFields, optionalDateLike } from "./common";
import { matterStatusSchema, paymentMethodSchema, matterRoleSchema } from "./enums";

/**
 * Matter (Ärende) — lagras i `matters/active/<id>.json`. Vi har inte längre
 * separata mappar för CLOSED/ARCHIVED — status:fältet räcker.
 */
export const matterSchema = z.object({
  ...orgScopedFields,
  matterNumber: z.string(),
  title: z.string(),
  description: z.string().nullish(),
  status: matterStatusSchema.default("ACTIVE"),
  matterType: z.string().nullish(),
  paymentMethod: paymentMethodSchema.default("PENDING"),
  paymentMethodNote: z.string().nullish(),
  paymentMethodDecidedAt: optionalDateLike,
  /**
   * `isTaxeArende` — ärendet ersätts enligt Domstolsverkets fastställda
   * taxa (schablon) istället för löpande timdebitering.
   *
   * Vanligast vid:
   *   - Brottmål med offentlig försvarare (brottmålstaxan)
   *   - Konkursförvaltning (konkursförvaltartaxan)
   *   - Förordnandemål, tolkuppdrag, helg-/jourförhandlingar
   *
   * Domstolen kan frångå taxan när "avsevärt mer arbete än normalt"
   * krävts — då gäller timkostnadsnormen istället. Se Domstolsverkets
   * DVFS-föreskrifter för aktuellt år (timkostnadsnorm 2026: 1 626 kr
   * ex moms med F-skatt).
   *
   * Separat dimension från `paymentMethod`: paymentMethod säger VEM
   * som betalar (stat, försäkring, klient), isTaxeArende säger HUR
   * ersättningen räknas.
   */
  isTaxeArende: z.boolean().default(false),
  /**
   * Nivå för brottmålstaxan (DVFS 2025:6):
   *   1 = grundersättning (bara HUF)
   *   2 = HUF + häktning / kvarstad / beslag / reseförbud
   *   3 = HUF + RPU (rättspsykiatrisk undersökning)
   *   4 = HUF + (häktning etc.) + RPU
   *
   * Relevant bara när isTaxeArende=true. Default 1.
   */
  taxaLevel: z.number().int().min(1).max(4).nullish(),
  /** Total förhandlingstid i minuter (input till `computeBrottmalstaxa`). */
  taxaHuvudforhandlingMin: z.number().int().nonnegative().nullish(),
  /** Default true. False → ersättning × 1237/1626 (DVFS 11 §). */
  taxaHasFTax: z.boolean().nullish(),
  /**
   * Start-tidpunkt för huvudförhandlingen. Auto-sparas av Kostnadsräkningens
   * modal så advokaten slipper minnas/skriva in den från scratch i
   * rättssalen — slut-tidpunkten triggas av "STOPPA NU".
   */
  taxaHufStart: optionalDateLike,
}).passthrough();

export type Matter = z.infer<typeof matterSchema>;

/**
 * MatterContact — kopplar Contact till Matter med en roll. En kontakt
 * kan ha flera roller på samma ärende (klient + ombud t.ex.).
 */
export const matterContactSchema = z.object({
  id: z.string(),
  matterId: z.string(),
  contactId: z.string(),
  role: matterRoleSchema,
  notes: z.string().nullish(),
  createdAt: z.union([z.date(), z.string()]).transform((v) => (v instanceof Date ? v : new Date(v))),
}).passthrough();

export type MatterContact = z.infer<typeof matterContactSchema>;
