/**
 * Försäkringsbolaget bland ärendets kontakter: villkoret för
 * försäkringsreferensen (#1511) och bolagsnamnet i ärendehuvudet (#1518).
 */

import { CONFLICT_SIDE } from "./conflict-roles";
import type { MatterRole } from "./schemas/enums";

/** Minsta formen av en ärendekontakt som villkoret behöver (kontakttypen är
 *  en `ContactType`, men villkoret tål även okänd/saknad typ). */
export interface MatterContactWithType {
  contact: { contactType?: string | null | undefined };
}

/** Ärendekontakt med sin roll i ärendet — behövs för att skilja ut motsidan. */
export interface MatterContactWithRole extends MatterContactWithType {
  role: MatterRole;
}

function isInsuranceCompany(c: MatterContactWithType): boolean {
  return c.contact.contactType === "INSURANCE_COMPANY";
}

/** Ärendets första försäkringsbolag som inte står på motsidan (motpart eller
 *  motpartsombud), annars `undefined`. Generisk så att anroparen får tillbaka
 *  sin egen kontaktform (t.ex. med namn). */
export function findInsuranceCompany<T extends MatterContactWithRole>(contacts: readonly T[]): T | undefined {
  return contacts.find((c) => isInsuranceCompany(c) && CONFLICT_SIDE[c.role] !== "ADVERSE");
}

/** Sant när minst en av ärendets kontakter är ett försäkringsbolag (oavsett roll). */
export function hasInsuranceCompany(contacts: readonly MatterContactWithType[]): boolean {
  return contacts.some(isInsuranceCompany);
}
