import { z } from "zod";
import { orgScopedFields, optionalDateLike } from "./common";
import { matterStatusSchema, paymentMethodSchema, matterRoleSchema } from "./enums";
import { matterIdSchema, matterContactIdSchema, contactIdSchema, userIdSchema } from "./ids";

/**
 * Matter (Ärende) — lagras i `matters/active/<id>.json`. Vi har inte längre
 * separata mappar för CLOSED/ARCHIVED — status:fältet räcker.
 */
export const matterSchema = z.object({
  ...orgScopedFields,
  id: matterIdSchema,
  matterNumber: z.string(),
  /**
   * Ansvarig advokat/biträdande jurist (#174). Styr ärendenummerserien:
   * numret prefixas med juristens `matterNumberPrefix` och löpnumret räknas
   * per jurist (`AA2026-0001`). Nullish = ingen ansvarig satt → org-gemensam
   * serie utan prefix (`2026-0001`, bakåtkompatibelt).
   */
  responsibleLawyerId: userIdSchema.nullish(),
  /**
   * Domstolens målnummer (#173/#175) — matchningsnyckel för avprickning av
   * domstolsbetalningar utan OCR (Domstolsverket anger målnummer i fri text).
   * Fri sträng (format varierar per domstol, t.ex. "B 1234-26").
   */
  courtCaseNumber: z.string().nullish(),
  title: z.string(),
  description: z.string().nullish(),
  status: matterStatusSchema.default("ACTIVE"),
  matterType: z.string().nullish(),
  paymentMethod: paymentMethodSchema.default("PENDING"),
  paymentMethodNote: z.string().nullish(),
  paymentMethodDecidedAt: optionalDateLike,
  /**
   * Klientens andel (självrisk/avgift) i basis points (2500 = 25 %) — relevant
   * för rättsskydd/rättshjälp där klienten betalar en %-sats av upparbetat
   * värde. Driver acconto-förslaget; kan ändras under ärendets gång (#778).
   */
  clientShareBips: z.number().int().min(0).max(10000).nullish(),
  /**
   * Rättsskyddets maxbelopp i öre (försäkringens tak, ur beslutet). När
   * upparbetat arvode-värde närmar sig (≥90 %) taket flaggas ärendet (#793).
   * Null = ej satt.
   */
  rattsskyddMaxOre: z.number().int().nonnegative().nullish(),
  /**
   * Rättshjälpens timtak (rättshjälpslagen: 100 tim, kan utökas). Null = ej satt;
   * UI defaultar 100 för rättshjälpsärenden. Vid ≥90 % flaggas ärendet (#793).
   */
  rattshjalpMaxTimmar: z.number().int().positive().nullish(),
  /**
   * Rättsskydd: det datum försäkringsbolaget fastställer att TVIST uppkom (ur
   * beslutet). Arbete före detta datum täcks ALDRIG → klienten betalar 100 %
   * fram till dess; därefter gäller självrisksandelen (#810). Null = ej satt.
   */
  tvistUppkomDatum: optionalDateLike,
  /**
   * Rättsskydd: datum för försäkringsbolagets POSITIVA beslut (ur beslutet).
   * Arbete före beslutet är retroaktivt och täcks med högst 6 h (#810). Null = ej satt.
   */
  rattsskyddBeslutDatum: optionalDateLike,
  /**
   * Rättsskydd: datum då försäkringen NEKADE rättsskydd (#811). Satt → nästa steg
   * är att ansöka om rättshjälp (om klientens ekonomiska underlag ≤ 6 § rättshjälps-
   * lagen). Null = ej nekat.
   */
  rattsskyddNekadAt: optionalDateLike,
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
  /**
   * Rättshjälp (#349/#383): tidpunkt då klientens rådgivningstimme (1 tim
   * enligt rättshjälpstaxan) registrerades som betald + fakturerad separat.
   * Null = ej registrerad. Styr text-raden på domstolens kostnadsräkning.
   */
  radgivningBetaldAt: optionalDateLike,
}).passthrough();

export type Matter = z.infer<typeof matterSchema>;

/**
 * MatterContact — kopplar Contact till Matter med en roll. En kontakt
 * kan ha flera roller på samma ärende (klient + ombud t.ex.).
 */
export const matterContactSchema = z.object({
  id: matterContactIdSchema,
  matterId: matterIdSchema,
  contactId: contactIdSchema,
  role: matterRoleSchema,
  notes: z.string().nullish(),
  createdAt: z.union([z.date(), z.string()]).transform((v) => (v instanceof Date ? v : new Date(v))),
}).passthrough();

export type MatterContact = z.infer<typeof matterContactSchema>;
