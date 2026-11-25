/**
 * `settlementBreakdownSchema` (#1938): nedbrytningen kan bära utläggsrader, och
 * en nedbrytning utan dem är giltig som förut. Schemat exporteras också vidare
 * ur `schemas/billing.ts` för befintliga importer.
 */
import { describe, expect, it } from "vitest-compat";
import { settlementBreakdownSchema as viaBilling } from "@/lib/shared/schemas/billing";
import { settlementBreakdownSchema } from "@/lib/shared/schemas/settlement-breakdown";

const BASE = { timeLines: [], rows: [{ label: "Aconto", amountOre: 100, kind: "add" }], totalLabel: "Att betala", totalOre: 100 };

describe("settlementBreakdownSchema", () => {
  it("en nedbrytning med utläggsrader tolkas", () => {
    const expenseLines = [{ date: "2026-05-02", description: "Resa", netOre: 100, grossOre: 125, passThrough: false }];
    expect(settlementBreakdownSchema.parse({ ...BASE, expenseLines })).toEqual({ ...BASE, expenseLines });
  });

  it("utan utläggsrader är den giltig som förut", () => {
    expect(settlementBreakdownSchema.parse(BASE)).toEqual(BASE);
  });

  it("en utläggsrad med belopp i bråkdelar av öre vägras", () => {
    const bad = { ...BASE, expenseLines: [{ date: "2026-05-02", description: "Resa", netOre: 1.5, grossOre: 2 }] };
    expect(settlementBreakdownSchema.safeParse(bad).success).toBe(false);
  });

  it("billing.ts exporterar samma schema vidare", () => {
    expect(viaBilling).toBe(settlementBreakdownSchema);
  });
});
