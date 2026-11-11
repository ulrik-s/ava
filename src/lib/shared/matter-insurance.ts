/**
 * Försäkringsbolaget bland ärendets kontakter: villkoret för
 * försäkringsreferensen (#1511) och bolagsnamnet i ärendehuvudet (#1518).
 */

/** Minsta formen av en ärendekontakt som villkoret behöver (kontakttypen är
 *  en `ContactType`, men villkoret tål även okänd/saknad typ). */
export interface MatterContactWithType {
  contact: { contactType?: string | null | undefined };
}

/** Ärendets första kontakt som är ett försäkringsbolag, annars `undefined`.
 *  Generisk så att anroparen får tillbaka sin egen kontaktform (t.ex. med namn). */
export function findInsuranceCompany<T extends MatterContactWithType>(contacts: readonly T[]): T | undefined {
  return contacts.find((c) => c.contact.contactType === "INSURANCE_COMPANY");
}

/** Sant när minst en av ärendets kontakter är ett försäkringsbolag. */
export function hasInsuranceCompany(contacts: readonly MatterContactWithType[]): boolean {
  return findInsuranceCompany(contacts) !== undefined;
}
