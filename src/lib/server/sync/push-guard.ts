/**
 * Synk-pushens regler (#1242) — det servern kontrollerar innan en köad
 * rad från en klient skrivs.
 *
 * Synk-push är radnivå: klienten skickar färdiga rader, och servern körde inte
 * om routrarnas regler. Utan de här kontrollerna kunde en klient
 * - skriva över eller radera en ANNAN byrås rader genom att skicka deras id,
 *   eller skapa rader i en annan byrås ärende, och
 * - skriva rader för tid, utlägg och fakturering förbi routrarnas regler
 *   (belopp, låsta poster, statusflöden). De entiteterna skrivs bara av
 *   procedurkön (`procedure-owned.ts`), och en färdig rad avvisas.
 */

import { isProcedureOwned, PROCEDURE_OWNED_REASON } from "@/lib/shared/sync/procedure-owned";

type Row = Record<string, unknown>;

/** Varför servern avvisade raden. `current` = serverns rad, när klienten får se den. */
export type PushRejection =
  | { reason: "annan byrå" | "okänd byrå" }
  | { reason: typeof PROCEDURE_OWNED_REASON; current?: Row };

/** Byrån en rad hör till (repons härledning), `undefined` om den inte går att avgöra. */
export type OrgOf = (row: Row) => Promise<string | undefined>;

/**
 * Raden måste höra till den pushande byrån: den befintliga raden, och raden som
 * blir resultatet (så att en egen rad inte kan flyttas till en annan byrå och
 * en ny rad inte kan läggas i en annan byrås ärende). Varje entitet har en
 * byrå — jävskontrollens logg via den som körde kontrollen (#1344).
 */
export async function checkScope(
  orgOf: OrgOf, org: string, existing: Row | null, incoming: Row | null,
): Promise<PushRejection | null> {
  if (existing && (await orgOf(existing)) !== org) return { reason: "annan byrå" };
  if (!incoming) return null;
  const target = await orgOf({ ...(existing ?? {}), ...incoming });
  if (target === undefined) return { reason: "okänd byrå" };
  return target === org ? null : { reason: "annan byrå" };
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Jämförbart värde: Date och ISO-tidpunkter som samma sträng, null för saknat. */
export function comparable(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string" && ISO_TIME.test(v)) return new Date(v).toISOString();
  return v ?? null;
}

/**
 * En procedurägd entitet (tid, utlägg, fakturering) skrivs bara av procedurkön
 * (#1242) — där kör servern om routrarnas regler. En färdig rad avvisas;
 * serverns rad (om den finns) följer med, så att klienten ser vad som gäller.
 */
export function checkProcedureOwned(entity: string, existing: Row | null): PushRejection | null {
  if (!isProcedureOwned(entity)) return null;
  return existing ? { reason: PROCEDURE_OWNED_REASON, current: existing } : { reason: PROCEDURE_OWNED_REASON };
}
