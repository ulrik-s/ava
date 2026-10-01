/**
 * Jävskontrollens rollregler (#1354) — vilka parter som kontrolleras och när en
 * träff i ett annat ärende är en intressekonflikt.
 *
 * Matchningen (namn, person-/organisationsnummer) bor i `conflict-match`. Här
 * avgörs bara vilken SIDA en roll står på:
 *
 *   - klientsidan: klienten,
 *   - motsidan: motparten och motpartens ombud,
 *   - neutral: åklagare, domstol, försäkringsbolag, vittne, ombud och övriga.
 *
 * En konflikt är när samma person eller organisation står på olika sidor —
 * klient här och motpart (eller motpartsombud) i ett annat av byråns ärenden,
 * eller tvärtom (VRGA 3.2.1: att biträda mot en nuvarande eller tidigare
 * klient). Att vara klient i flera av byråns ärenden är ingen konflikt, och
 * inte heller att vara motpart i flera. Neutrala roller ger inga träffar och
 * kontrolleras inte: ett vittne eller en domstol är inte part.
 */

import type { MatterRole, UserRole } from "./schemas/enums";

/** Den sida av saken en roll står på. */
export type ConflictSide = "CLIENT" | "ADVERSE" | "NEUTRAL";

/** Varje roll i ärendet → sida. Ny roll = kompileringsfel tills den placerats. */
export const CONFLICT_SIDE: Readonly<Record<MatterRole, ConflictSide>> = Object.freeze({
  KLIENT: "CLIENT",
  MOTPART: "ADVERSE",
  MOTPARTSOMBUD: "ADVERSE",
  AKLAGARE: "NEUTRAL",
  DOMSTOL: "NEUTRAL",
  FORSAKRINGSBOLAG: "NEUTRAL",
  VITTNE: "NEUTRAL",
  OMBUD: "NEUTRAL",
  OVRIG: "NEUTRAL",
});

/** Kontrolleras parten i den här rollen mot byråns andra ärenden? */
export function isCheckedRole(role: MatterRole): boolean {
  return CONFLICT_SIDE[role] !== "NEUTRAL";
}

/**
 * Är en träff i rollen `elsewhere` (ett annat ärende) en konflikt för en part i
 * rollen `here`? Ja när de står på olika sidor, och ingen av dem är neutral.
 */
export function isConflictingRole(here: MatterRole, elsewhere: MatterRole): boolean {
  const a = CONFLICT_SIDE[here];
  const b = CONFLICT_SIDE[elsewhere];
  return a !== "NEUTRAL" && b !== "NEUTRAL" && a !== b;
}

/**
 * Vem som får bedöma träffarna och ta uppdraget: advokaten (och byråns admin,
 * som i de små byråerna är en delägare). Ansvaret för att jäv inte föreligger
 * är advokatens (VRGA 3.2) — en assistent kan köra om kontrollen men inte
 * avgöra den.
 */
const REVIEWER_ROLES: ReadonlySet<UserRole> = new Set<UserRole>(["ADMIN", "LAWYER"]);

/** Får en användare i rollen bedöma jävskontrollens träffar? */
export function mayReviewConflicts(role: UserRole): boolean {
  return REVIEWER_ROLES.has(role);
}
