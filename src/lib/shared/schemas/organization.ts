import { z } from "zod";
import { ledgerAccountMapSchema } from "../accounting/account-map";
import { orgImageSchema } from "../org-image";
import { standardAtgardSchema } from "../standard-atgard";
import { baseFields, dateLike } from "./common";
import { hourlyRatesSchema } from "./hourly-rates";
import { organizationIdSchema, officeIdSchema } from "./ids";

/**
 * Organisation = byrå. En per git-repo (vanligen). Lagras i
 * `.ava/organizations/<id>.json`.
 */
export const organizationSchema = z.object({
  ...baseFields,
  id: organizationIdSchema,
  name: z.string(),
  orgNumber: z.string().nullish(),
  address: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().nullish(),
  bankgiro: z.string().nullish(),
  /** Webbplats (t.ex. "https://www.exempel.se") — kostnadsräkningens sidfot (#1218). */
  website: z.string().nullish(),
  /** Logga (PNG/JPEG data-URL, ≤ 300 kB) överst i genererade dokument (#1218). */
  logo: orgImageSchema.nullish(),
  /** Märke i sidfoten, t.ex. "Ledamot av Sveriges advokatsamfund" (#1218). */
  footerSeal: orgImageSchema.nullish(),
  /** Entra ID tenant-id för O365 single-tenant-inloggning. Server-only fält. */
  azureTenantId: z.string().nullish(),
  /** Per-byrå roll→konto-mappning för bokföringsexport (SIE m.fl., #249). */
  ledgerAccountMap: ledgerAccountMapSchema.nullish(),
  /** Byråns egna dokumenttyper (ADR 0038), utöver de inbyggda. Valen i
   *  "Redigera uppgifter…" och AI:ns förslag; redigeras i Inställningar. */
  documentKinds: z.array(z.string()).default([]),
  /** Föråldrad: Taggvokabulären (#621), ersatt av `documentKinds` (ADR 0038). */
  documentTags: z.array(z.string()).default([]),
  /** Byråns ärendetyper — valen i "Ärendetyp" när ett ärende läggs upp. */
  matterTypes: z.array(z.string()).default([]),
  /** De av byråns ärendetyper som är offentligt uppdrag (t.ex. offentlig
   *  försvarare). `null`/saknas = aldrig satt (inga markerade); `[]` = satt
   *  till tom lista. Skillnaden styr en senare engångsuppdatering (#1640). */
  publicAssignmentMatterTypes: z.array(z.string()).nullish(),
  /** Gränsbelopp (öre) för klientens ackumulerade självrisk innan ett aconto
   *  skickas (#885). NULL = använd default (SJALVRISK_ACCONTO_THRESHOLD_ORE). */
  accontoThresholdOre: z.number().int().nonnegative().nullish(),
  /** Byråns timpris per kategori (öre/h, exkl moms) — minst specifika nivån,
   *  gäller när varken ärendet eller juristen har ett eget (#1206). */
  hourlyRates: hourlyRatesSchema.default({}),
  /** Byråns standardåtgärder (#956) — åtgärder som förekommer i varje ärende med
   *  samma beskrivning och tidsåtgång för alla på byrån. Redigeras i org-inställningarna. */
  standardAtgarder: z.array(standardAtgardSchema).default([]),
}).passthrough();

export type Organization = z.infer<typeof organizationSchema>;

export const officeSchema = z.object({
  ...baseFields,
  id: officeIdSchema,
  organizationId: organizationIdSchema,
  name: z.string(),
  address: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().nullish(),
  isMain: z.boolean().default(false),
}).passthrough();

export type Office = z.infer<typeof officeSchema>;

// Hydrate-working-copy ger lastSyncedAt-fältet på org-raden. Ej i Prisma men
// kan finnas i git-clones från äldre versioner. .passthrough() ovan tillåter
// extra fält utan att fail:a parsningen.
export { dateLike };
