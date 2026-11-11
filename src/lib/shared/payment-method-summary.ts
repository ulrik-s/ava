/**
 * Betalningssättet som en rad i ärendehuvudet (#1518), t.ex.
 * "Rättsskydd · Folksam · klienten betalar 20 %". Bara visning: betalningssättet
 * styr faktureringsflödet (ADR 0034), men här ändras inget.
 */

import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/shared/schemas/enums";
import { shareLabel } from "@/lib/shared/settlement-view";

/** Det som raden byggs av. Saknade delar utelämnas utan tom avgränsare. */
export interface PaymentMethodSummaryInput {
  paymentMethod: PaymentMethod;
  /** Klientens andel i baspunkter (10 000 = 100 %). */
  clientShareBips?: number | null | undefined;
  /** Namnet på ärendets försäkringsbolag (visas bara vid rättsskydd). */
  insurerName?: string | null | undefined;
}

/** Avgränsaren mellan delarna, samma som i raden klient · ärendetyp. */
export const SUMMARY_SEPARATOR = " · ";

function clientShareText(bips: number | null | undefined): string | null {
  return bips == null ? null : `klienten betalar ${shareLabel(bips)} %`;
}

/** Delarna efter etiketten, per betalningssätt. */
function detailParts({ paymentMethod, clientShareBips, insurerName }: PaymentMethodSummaryInput): Array<string | null | undefined> {
  if (paymentMethod === "RATTSSKYDD") return [insurerName, clientShareText(clientShareBips)];
  if (paymentMethod === "RATTSHJALP") return [clientShareText(clientShareBips)];
  return [];
}

/** Hela raden: etiketten följd av de delar som finns. */
export function paymentMethodSummary(input: PaymentMethodSummaryInput): string {
  const parts = [PAYMENT_METHOD_LABELS[input.paymentMethod], ...detailParts(input)];
  return parts.filter((p): p is string => typeof p === "string" && p !== "").join(SUMMARY_SEPARATOR);
}
