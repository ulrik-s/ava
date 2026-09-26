/**
 * Vilket timpris en ny tidspost får vid privat fakturering (#1195, #1199).
 *
 * Priset sparas på posten, så en senare ändring av byråns, juristens eller
 * ärendets pris rör inte redan registrerad tid. Rättshjälp/taxa berörs inte:
 * där värderas posten på Domstolsverkets normer vid slutregleringen.
 */
import type { TimeEntryKind } from "./schemas/enums";

/** Ett timpris i öre/h, eller inget satt. */
type OptionalRate = number | null | undefined;

/** Timprisen som kan gälla för en post, från mest till minst specifik. */
export interface HourlyRateSources {
  /** Ärendets avvikande timpris (ovanligt). */
  matterRate: OptionalRate;
  /** Juristens eget timpris. */
  userRate: OptionalRate;
  /** Byråns standardtimpris. */
  orgDefaultRate: OptionalRate;
  /** Byråns timpris för tidsspillan — tomt = samma som arbete. */
  orgTidsspillanRate: OptionalRate;
}

/** Tidsspillan, vardag 08–18 eller annan tid. */
export function isTidsspillanKind(kind: TimeEntryKind | null | undefined): boolean {
  return kind === "TIDSSPILLAN" || kind === "TIDSSPILLAN_OVRIG_TID";
}

/**
 * Tidsspillan med ett satt tidsspillan-pris får det priset; allt annat får
 * ärendets → juristens → byråns standard → 0.
 */
export function hourlyRateForKind(kind: TimeEntryKind | null | undefined, rates: HourlyRateSources): number {
  if (isTidsspillanKind(kind) && rates.orgTidsspillanRate != null) return rates.orgTidsspillanRate;
  return rates.matterRate ?? rates.userRate ?? rates.orgDefaultRate ?? 0;
}
