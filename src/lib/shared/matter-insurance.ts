/**
 * Försäkringsbolaget bland ärendets kontakter: villkoret för
 * försäkringsreferensen (#1511) och bolagsnamnet i ärendehuvudet (#1518).
 * Rollen avgör partens slag (#1961), som för klient och domstol: ett
 * försäkringsbolag är en part med rollen Försäkringsbolag, oavsett kontakttyp.
 */

import type { MatterRole } from "./schemas/enums";

/** Minsta formen av en ärendekontakt som villkoret behöver: dess roll i ärendet. */
export interface MatterContactWithRole {
  role: MatterRole;
}

/** Ärendets första part med rollen Försäkringsbolag, annars `undefined`.
 *  Generisk så att anroparen får tillbaka sin egen kontaktform (t.ex. med namn). */
export function findInsuranceCompany<T extends MatterContactWithRole>(contacts: readonly T[]): T | undefined {
  return contacts.find((c) => c.role === "FORSAKRINGSBOLAG");
}

/** Sant när ärendet har en part med rollen Försäkringsbolag — samma regel som
 *  `findInsuranceCompany`. */
export function hasInsuranceCompany(contacts: readonly MatterContactWithRole[]): boolean {
  return findInsuranceCompany(contacts) !== undefined;
}
