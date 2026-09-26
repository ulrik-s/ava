/**
 * Vilket timpris en tidspost får vid privat fakturering (#1195, #1199, #1206).
 *
 * Varje timbaserad kategori (timarvode, timarvode helg/kväll, tidsspillan,
 * tidsspillan helg/kväll) har ett eget pris som ärvs byrå → jurist → ärende:
 * den mest specifika nivån som satt ett pris FÖR KATEGORIN vinner. Har ingen
 * nivå satt något för en kategori utöver timarvode används timarvodet, löst
 * genom samma kedja; finns inget alls blir priset 0.
 *
 * Priset sparas på posten, så en senare ändring av byråns, juristens eller
 * ärendets pris rör inte redan registrerad tid (men ett kategoribyte räknar om
 * det). Rättshjälp/taxa berörs inte: där värderas posten på Domstolsverkets
 * normer vid slutregleringen.
 */
import { hourlyTimeEntryKindSchema, type HourlyTimeEntryKind, type TimeEntryKind } from "./schemas/enums";
import type { HourlyRates } from "./schemas/hourly-rates";

/** En nivås timpriser; saknas nivån (inget ärende, ingen jurist) = null/undefined. */
export type LevelRates = HourlyRates | null | undefined;

/** Nivåerna ett pris ärvs genom. */
export interface HourlyRateLevels {
  /** Ärendets avvikande priser (ovanligt) — mest specifikt. */
  matter?: LevelRates;
  /** Juristens egna priser. */
  user?: LevelRates;
  /** Byråns priser — minst specifikt. */
  org?: LevelRates;
}

/** Tidsspillan, vardag 08–18 eller helg/kväll. */
export function isTidsspillanKind(kind: TimeEntryKind | null | undefined): boolean {
  return kind === "TIDSSPILLAN" || kind === "TIDSSPILLAN_OVRIG_TID";
}

/** Är kategorin timbaserad (har ett eget timpris)? Advokatberedskap ersätts per dag. */
export function isHourlyKind(kind: TimeEntryKind): kind is HourlyTimeEntryKind {
  return hourlyTimeEntryKindSchema.safeParse(kind).success;
}

/** Första nivån i kedjan (mest specifik först) som satt ett pris för `kind`. */
function firstRate(kind: HourlyTimeEntryKind, chain: readonly LevelRates[]): number | undefined {
  for (const level of chain) {
    const rate = level?.[kind];
    if (rate != null) return rate;
  }
  return undefined;
}

/** Kategorins eget pris genom kedjan, annars timarvodet genom samma kedja. */
function chainRate(kind: HourlyTimeEntryKind, chain: readonly LevelRates[]): number | undefined {
  return firstRate(kind, chain) ?? firstRate("ARBETE", chain);
}

/**
 * Timpriset (öre/h) för `kind`: ärende → jurist → byrå för kategorin; annars
 * timarvodet genom samma kedja; annars 0.
 */
export function resolveHourlyRate(kind: HourlyTimeEntryKind, levels: HourlyRateLevels): number {
  return chainRate(kind, [levels.matter, levels.user, levels.org]) ?? 0;
}

/**
 * Det pris en nivå hade ÄRVT för `kind` om den inte satt ett eget — det som
 * formulärets tomma fält visar som "ärvs: …". `own` är nivåns egna priser (dess
 * övriga kategorier räknas, t.ex. juristens timarvode för hens tidsspillan),
 * `parents` nivåerna ovanför, mest specifik först. Undefined = inget att ärva.
 */
export function inheritedHourlyRate(
  kind: HourlyTimeEntryKind, own: HourlyRates, parents: readonly LevelRates[],
): number | undefined {
  const withoutKind: HourlyRates = { ...own };
  delete withoutKind[kind];
  return chainRate(kind, [withoutKind, ...parents]);
}
