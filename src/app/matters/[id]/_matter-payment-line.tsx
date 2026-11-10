/**
 * Betalningssätt + kreditrisk-märke under klientraden i ärendehuvudet (#1498).
 * Utbruten ur MatterHeader så dess komplexitet förblir låg.
 */

import { RISK_BADGE } from "@/components/matter/payment-method-card";
import { PAYMENT_METHOD_LABELS, creditRiskFor, CREDIT_RISK_LABELS } from "@/lib/client/labels";
import type { PaymentMethod } from "@/lib/shared/schemas/enums";

/** Rättsskydd/rättshjälp: klienten betalar en %-sats. */
function sharesWithClient(method: PaymentMethod): boolean {
  return method === "RATTSSKYDD" || method === "RATTSHJALP";
}

export function MatterPaymentLine({ paymentMethod, clientShareBips }: {
  paymentMethod: PaymentMethod;
  clientShareBips: number | null;
}) {
  const risk = creditRiskFor(paymentMethod);
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
      <span>Betalningssätt: {PAYMENT_METHOD_LABELS[paymentMethod]}</span>
      <span className={`text-xs rounded-full px-2 py-0.5 border ${RISK_BADGE[risk]}`}>
        Kreditrisk: {CREDIT_RISK_LABELS[risk]}
      </span>
      {sharesWithClient(paymentMethod) && clientShareBips != null && (
        <span className="text-xs">Klientens andel: {clientShareBips / 100} %</span>
      )}
    </p>
  );
}
