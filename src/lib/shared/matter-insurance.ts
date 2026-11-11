/**
 * Försäkringsreferens på ärendet (#1511): fältet är bara meningsfullt när ett
 * försäkringsbolag är kopplat till ärendet som kontakt.
 */

/** Minsta formen av en ärendekontakt som villkoret behöver (kontakttypen är
 *  en `ContactType`, men villkoret tål även okänd/saknad typ). */
export interface MatterContactWithType {
  contact: { contactType?: string | null | undefined };
}

/** Sant när minst en av ärendets kontakter är ett försäkringsbolag. */
export function hasInsuranceCompany(contacts: readonly MatterContactWithType[]): boolean {
  return contacts.some((c) => c.contact.contactType === "INSURANCE_COMPANY");
}
