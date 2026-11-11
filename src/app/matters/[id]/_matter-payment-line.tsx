/**
 * Betalningssättet i ärendehuvudet (#1518), på samma rad som klient · ärendetyp.
 * Utbruten ur MatterHeader på samma sätt som MatterClientLine (#199).
 */

import { findInsuranceCompany, type MatterContactWithType } from "@/lib/shared/matter-insurance";
import { paymentMethodSummary, SUMMARY_SEPARATOR } from "@/lib/shared/payment-method-summary";
import type { PaymentMethod } from "@/lib/shared/schemas/enums";

/** Ärendekontakt med namn — namnet visas för försäkringsbolaget. */
export type NamedMatterContact = MatterContactWithType & { contact: { name: string } };

export function MatterPaymentLine({ paymentMethod, clientShareBips, contacts, separated }: {
  paymentMethod: PaymentMethod;
  clientShareBips?: number | null | undefined;
  contacts: readonly NamedMatterContact[];
  /** Sant när raden redan har innehåll före betalningssättet (klient/ärendetyp). */
  separated: boolean;
}) {
  const insurerName = findInsuranceCompany(contacts)?.contact.name;
  return (
    <span className="whitespace-pre-wrap text-sm text-gray-500" data-testid="matter-payment-line">
      {separated ? SUMMARY_SEPARATOR : ""}
      {paymentMethodSummary({ paymentMethod, clientShareBips, insurerName })}
    </span>
  );
}
