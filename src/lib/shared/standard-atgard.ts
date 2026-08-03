/**
 * Byråns STANDARDÅTGÄRDER (#956) — åtgärder som förekommer i varje ärende och
 * som ska registreras med samma beskrivning och samma tidsåtgång av alla på
 * byrån, t.ex. "Inledande åtgärder och genomgång av handlingar" 30 min.
 *
 * Listan är BYRÅKONFIGURATION: den bor på organisationen (samma mönster som
 * `documentTags`, #621), så den synkar via git och är identisk för alla. Varje
 * post har ett stabilt `id` så en tidspost kan referera den (`standardAtgardId`)
 * — då syns det vilka poster som kommer ur en standard och om tiden justerats.
 *
 * Tidsåtgången är en HUVUDREGEL, inte ett lås: juristen ska kunna avvika i det
 * enskilda ärendet (annars håller den inte om domstolen frågar).
 */

import { z } from "zod";
import { paymentMethodSchema, timeEntryKindSchema, type PaymentMethod } from "./schemas/enums";

/**
 * När åtgärden normalt hör hemma i uppdraget. Styr var den FÖRESLÅS — den kan
 * alltid registreras manuellt oavsett skede.
 */
export const STANDARD_ATGARD_STAGE_LABELS = {
  OPENING: "Inledande — vid uppdragets början",
  CLOSING: "Avslutande — vid dom eller avslut",
  ANY: "Löpande — när som helst under uppdraget",
} as const satisfies Record<string, string>;

export const standardAtgardStageSchema = z.enum(["OPENING", "CLOSING", "ANY"]);
export type StandardAtgardStage = z.infer<typeof standardAtgardStageSchema>;

/**
 * KRONOLOGISK ordning för presentation: inledande → löpande → avslutande.
 * Egen konstant, inte enumets deklarationsordning — den grupperar de två
 * livscykel-skedena och råkar därför sätta CLOSING före ANY.
 */
const STAGE_ORDER: Record<StandardAtgardStage, number> = { OPENING: 0, ANY: 1, CLOSING: 2 };

export const standardAtgardSchema = z.object({
  /** Stabilt id (slug eller uuid) — refereras av tidsposten. */
  id: z.string().min(1),
  /** Ordalydelsen som hamnar på tidsposten, och därmed i kostnadsräkningen. */
  description: z.string().min(1),
  /** Tidsåtgången som huvudregel. Redigerbar per tidspost. */
  minutes: z.number().int().positive(),
  /** Arvodeskategori (#953) — nästan alltid ARBETE, men helgtaxan kan förekomma. */
  kind: timeEntryKindSchema.default("ARBETE"),
  stage: standardAtgardStageSchema.default("ANY"),
  /** Betalningssätt åtgärden gäller. TOM = alla (det normala). */
  paymentMethods: z.array(paymentMethodSchema).default([]),
  billable: z.boolean().default(true),
  /** Avställd åtgärd behålls för historikens skull men föreslås inte längre. */
  active: z.boolean().default(true),
});

export type StandardAtgard = z.infer<typeof standardAtgardSchema>;

/**
 * Byråns åtgärder som gäller ett ärende: aktiva, och antingen utan
 * betalningssätts-begränsning eller med ärendets betalningssätt i listan.
 * `stage` filtrerar valfritt (förslagsvägen); utan `stage` returneras alla
 * tillämpliga (väljaren i tidsformuläret).
 *
 * Ordningen är skede-ordning (inledande → löpande → avslutande) och därefter
 * beskrivning, så listan ser likadan ut för alla på byrån.
 */
export function applicableStandardAtgarder(
  list: readonly StandardAtgard[] | null | undefined,
  paymentMethod: PaymentMethod | null | undefined,
  stage?: StandardAtgardStage,
): StandardAtgard[] {
  return (list ?? [])
    .filter((a) => a.active)
    .filter((a) => stage === undefined || a.stage === stage)
    .filter((a) => appliesToMethod(a, paymentMethod))
    .sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || a.description.localeCompare(b.description, "sv"));
}

/** Tom `paymentMethods` = åtgärden gäller alla betalningssätt. */
function appliesToMethod(a: StandardAtgard, paymentMethod: PaymentMethod | null | undefined): boolean {
  if (a.paymentMethods.length === 0) return true;
  return paymentMethod != null && a.paymentMethods.includes(paymentMethod);
}

/**
 * Ärendets läge, för att avgöra VILKA standardåtgärder som är relevanta att
 * föreslå just nu (#958). Rena fakta om ärendet — ingen I/O, ingen tRPC.
 */
export interface StandardAtgardContext {
  /** Har ärendet några registrerade tidsposter? Nej → uppdraget är nyss påbörjat. */
  hasTimeEntries: boolean;
  /** Är domen/beslutet registrerat? Då hör de avslutande åtgärderna hemma nu. */
  verdictRegistered: boolean;
  /** Är ärendet stängt? Täcker avslut UTAN kostnadsräkning (rättsskydd, privat). */
  matterClosed: boolean;
  /** Är ärendet slutreglerat? Då är arbetet FRYST och en ny tidspost når aldrig
   *  fakturan — att föreslå en åtgärd som inte kan faktureras vore vilseledande. */
  settled: boolean;
  /** Standardåtgärder som redan registrerats i ärendet (`standardAtgardId`). */
  registeredIds: ReadonlySet<string>;
}

/**
 * Standardåtgärder att FÖRESLÅ för ärendet just nu (#958) — de som hör till
 * ärendets skede och ännu inte är registrerade.
 *
 * `ANY`-åtgärder föreslås aldrig: de gäller när som helst och skulle ligga kvar
 * som en permanent uppmaning. De finns i väljaren i tidsformuläret i stället.
 */
export function suggestedStandardAtgarder(
  list: readonly StandardAtgard[] | null | undefined,
  paymentMethod: PaymentMethod | null | undefined,
  ctx: StandardAtgardContext,
): StandardAtgard[] {
  if (ctx.settled) return [];
  const stages: StandardAtgardStage[] = [];
  if (!ctx.hasTimeEntries) stages.push("OPENING");
  if (ctx.verdictRegistered || ctx.matterClosed) stages.push("CLOSING");
  return stages
    .flatMap((stage) => applicableStandardAtgarder(list, paymentMethod, stage))
    .filter((a) => !ctx.registeredIds.has(a.id));
}

/**
 * Normalisera en inkommande lista (admin sparar hela listan): trimma texter,
 * släng poster utan beskrivning, och dedupa på `id` — sista vinner, så en
 * redigerad post ersätter sin tidigare version i stället för att dubbleras.
 */
export function normalizeStandardAtgarder(list: readonly StandardAtgard[]): StandardAtgard[] {
  const byId = new Map<string, StandardAtgard>();
  for (const a of list) {
    const description = a.description.trim();
    if (!description) continue;
    byId.set(a.id, { ...a, id: a.id.trim(), description });
  }
  return [...byId.values()];
}
