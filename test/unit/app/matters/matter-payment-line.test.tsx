/**
 * Tester för MatterPaymentLine (#1498) — betalningssätt i ärendehuvudet.
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest-compat";
import { MatterPaymentLine } from "@/app/matters/[id]/_matter-payment-line";
import { CREDIT_RISK_LABELS, PAYMENT_METHOD_LABELS, creditRiskFor } from "@/lib/client/labels";
import { paymentMethodSchema } from "@/lib/shared/schemas/enums";

describe("MatterPaymentLine", () => {
  for (const method of paymentMethodSchema.options) {
    it(`visar etikett och risk-märke för ${method}`, () => {
      render(<MatterPaymentLine paymentMethod={method} clientShareBips={2500} />);
      expect(screen.getByText(`Betalningssätt: ${PAYMENT_METHOD_LABELS[method]}`)).toBeInTheDocument();
      expect(screen.getByText(`Kreditrisk: ${CREDIT_RISK_LABELS[creditRiskFor(method)]}`)).toBeInTheDocument();
      const shown = method === "RATTSSKYDD" || method === "RATTSHJALP";
      expect(screen.queryByText("Klientens andel: 25 %") !== null).toBe(shown);
    });
  }

  it("andel utelämnas när den inte är satt", () => {
    render(<MatterPaymentLine paymentMethod="RATTSSKYDD" clientShareBips={null} />);
    expect(screen.queryByText(/Klientens andel/)).not.toBeInTheDocument();
  });
});
