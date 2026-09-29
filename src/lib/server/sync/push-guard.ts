/**
 * Synk-pushens regler (#1242, del 1) — det servern kontrollerar innan en köad
 * rad från en klient skrivs.
 *
 * Synk-push är radnivå: klienten skickar färdiga rader, och servern körde inte
 * om routrarnas regler. Utan de här kontrollerna kunde en klient
 * - skriva över eller radera en ANNAN byrås rader genom att skicka deras id,
 *   eller skapa rader i en annan byrås ärende, och
 * - ändra eller radera låsta tidsposter och utlägg (frysta av en
 *   fakturerings-körning eller fakturerade) — det routrarna vägrar.
 *
 * Fakturornas belopp och statusövergångar är del 2 av #1242.
 */

import { asId } from "@/lib/shared/schemas/ids";
import { isBilledEntry } from "@/lib/shared/time-entry-lock";

type Row = Record<string, unknown>;

/** Varför servern avvisade raden. `current` = serverns rad, när klienten får se den. */
export type PushRejection =
  | { reason: "annan byrå" | "okänd byrå" }
  | { reason: "låst"; current: Row };

/** Byrån en rad hör till (repons härledning), `undefined` om den inte går att avgöra. */
export type OrgOf = (row: Row) => Promise<string | undefined>;

/**
 * Entiteter utan byrå i schemat — konfliktkontrollernas logg har varken byrå,
 * ärende eller faktura att härleda den ur. De kan inte avgränsas här.
 */
const UNSCOPED = new Set(["conflictCheck"]);

/**
 * Raden måste höra till den pushande byrån: den befintliga raden, och raden som
 * blir resultatet (så att en egen rad inte kan flyttas till en annan byrå och
 * en ny rad inte kan läggas i en annan byrås ärende).
 */
export async function checkScope(
  orgOf: OrgOf, org: string, entity: string, existing: Row | null, incoming: Row | null,
): Promise<PushRejection | null> {
  if (UNSCOPED.has(entity)) return null;
  if (existing && (await orgOf(existing)) !== org) return { reason: "annan byrå" };
  if (!incoming) return null;
  const target = await orgOf({ ...(existing ?? {}), ...incoming });
  if (target === undefined) return { reason: "okänd byrå" };
  return target === org ? null : { reason: "annan byrå" };
}

/**
 * Fälten som redovisats när posten låstes. Låsfälten själva (`frozenAt`,
 * `frozenByBillingRunId`, `invoiceId`) får ändras — en körning som tas bort
 * låser upp sina poster.
 */
const LOCKED_FIELDS: Readonly<Record<string, readonly string[]>> = {
  timeEntry: ["matterId", "userId", "date", "minutes", "description", "billable", "hourlyRate", "kind"],
  expense: ["matterId", "userId", "date", "amount", "description", "billable", "vatRate", "vatIncluded", "passThrough"],
};

/** Låst eller fakturerad — samma regel som routrarna (`isBilledEntry`). */
function isLocked(row: Row): boolean {
  const runId = row.frozenByBillingRunId;
  return isBilledEntry({
    frozenAt: row.frozenAt == null ? null : String(row.frozenAt),
    frozenByBillingRunId: typeof runId === "string" ? asId<"BillingRunId">(runId) : null,
    invoiceId: typeof row.invoiceId === "string" ? row.invoiceId : null,
  });
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Jämförbart värde: Date och ISO-tidpunkter som samma sträng, null för saknat. */
function comparable(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string" && ISO_TIME.test(v)) return new Date(v).toISOString();
  return v ?? null;
}

function changes(existing: Row, incoming: Row, field: string): boolean {
  return field in incoming && comparable(existing[field]) !== comparable(incoming[field]);
}

/** En låst tidspost eller ett låst utlägg får varken ändras i sak eller raderas. */
export function checkLocked(entity: string, existing: Row | null, incoming: Row | null): PushRejection | null {
  const fields = LOCKED_FIELDS[entity];
  if (!fields || !existing || !isLocked(existing)) return null;
  const touched = incoming === null || fields.some((f) => changes(existing, incoming, f));
  return touched ? { reason: "låst", current: existing } : null;
}
