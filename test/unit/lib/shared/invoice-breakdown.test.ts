/**
 * `invoiceBreakdown` (#2180, contract #2192): en kolumn per fakturatyp, utan
 * reserv. Acontot läser `accontoBreakdown`; slut- och kreditfakturan
 * `settlementBreakdown`.
 */
import { describe, expect, it } from "vitest-compat";
import { invoiceBreakdown } from "@/lib/shared/billing/settlement-view";

const view = (totalOre: number) => ({ timeLines: [], rows: [], totalLabel: "Att betala", totalOre });

describe("invoiceBreakdown", () => {
  it("acontot läser sin egen kolumn", () => {
    expect(invoiceBreakdown({ invoiceType: "ACCONTO", accontoBreakdown: view(1), settlementBreakdown: view(2) })).toEqual(view(1));
  });

  it("ett aconto med bara settlementBreakdown ger ingen nedbrytning (ingen reserv)", () => {
    expect(invoiceBreakdown({ invoiceType: "ACCONTO", settlementBreakdown: view(2) })).toBeNull();
  });

  it("slut-, kredit- och övriga fakturor läser settlementBreakdown, aldrig accontoBreakdown", () => {
    expect(invoiceBreakdown({ invoiceType: "FINAL", accontoBreakdown: view(1), settlementBreakdown: view(2) })).toEqual(view(2));
    expect(invoiceBreakdown({ invoiceType: "CREDIT", settlementBreakdown: view(3) })).toEqual(view(3));
    expect(invoiceBreakdown({ invoiceType: "STANDARD", accontoBreakdown: view(1) })).toBeNull();
    expect(invoiceBreakdown({ settlementBreakdown: view(4) })).toEqual(view(4));
  });

  it("ingen nedbrytning → null", () => {
    expect(invoiceBreakdown({})).toBeNull();
    expect(invoiceBreakdown({ invoiceType: "ACCONTO", accontoBreakdown: undefined, settlementBreakdown: null })).toBeNull();
  });
});
