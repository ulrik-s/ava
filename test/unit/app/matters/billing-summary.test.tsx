/**
 * `BillingSummary` (#1236) — fakturapanelens fyra summa-kort. Verifierar att
 * kostnadsräkningens yrkade belopp och skapade-ej-skickade fakturor syns, utan
 * dubbelräkning när KR:n faktureras, samt den responsiva layouten.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { BillingSummary } from "@/app/matters/[id]/_billing-summary";
import type { SummaryInvoice, SummaryRun } from "@/lib/shared/billing-summary";
import type { KostnadsrakningStatus } from "@/lib/shared/kostnadsrakning-flow";
import type { BillingRunStatus } from "@/lib/shared/schemas/enums";
import { asId } from "@/lib/shared/schemas/ids";

let workValueOre = 0;
let invoices: SummaryInvoice[] = [];

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    billingRun: { proposal: { useQuery: () => ({ data: { workValueOre } }) } },
    invoice: { list: { useQuery: () => ({ data: { items: invoices, total: invoices.length } }) } },
  },
}));

const matterId = asId<"MatterId">("m1");
const kr = (s: KostnadsrakningStatus, amountOre: number, status: BillingRunStatus = "PENDING_VERDICT"): SummaryRun =>
  ({ type: "KOSTNADSRAKNING", status, recipient: "DOMSTOL", kostnadsrakningStatus: s, amountOre });
const inv = (id: string, amount: number, status: SummaryInvoice["status"]): SummaryInvoice =>
  ({ id: asId<"InvoiceId">(id), amount, status, payments: [] });

/** Kortets beloppsknapp (första `<Money>` i kortet). */
function cardAmount(label: string): string {
  const card = screen.getByText(label).parentElement;
  if (!card) throw new Error(`kort saknas: ${label}`);
  return within(card).getAllByRole("button")[0]?.textContent ?? "";
}

beforeEach(() => {
  workValueOre = 0;
  invoices = [];
});

describe("BillingSummary (#1236)", () => {
  it("allt fryst av en inskickad KR → Yrkat i kostnadsräkning visar det yrkade", () => {
    render(<BillingSummary matterId={matterId} runs={[kr("INSKICKAD", 1_234_500)]} />);
    expect(cardAmount("Upparbetat ofakturerat")).toMatch(/0,00/);
    expect(cardAmount("Yrkat i kostnadsräkning")).toMatch(/12\s*345,00/);
    expect(cardAmount("Fakturerat")).toMatch(/^0,00/);
  });

  it("beslutad men ej fakturerad KR räknas fortfarande som yrkad", () => {
    render(<BillingSummary matterId={matterId} runs={[kr("BESLUTAD", 500_000)]} />);
    expect(cardAmount("Yrkat i kostnadsräkning")).toMatch(/5\s*000,00/);
  });

  it("fakturerad KR flyttar till Fakturerat — ingen dubbelräkning", () => {
    invoices = [inv("f1", 450_000, "DRAFT")];
    render(<BillingSummary matterId={matterId} runs={[kr("FAKTURERAD", 450_000, "SENT")]} />);
    expect(cardAmount("Yrkat i kostnadsräkning")).toMatch(/^0,00/);
    expect(cardAmount("Fakturerat")).toMatch(/4\s*500,00/);
  });

  it("DRAFT ingår i Fakturerat med 'varav skapat, ej skickat'; annullerad exkluderas", () => {
    invoices = [inv("a", 100_000, "SENT"), inv("b", 20_000, "DRAFT"), inv("c", 999_900, "CANCELLED")];
    render(<BillingSummary matterId={matterId} runs={[]} />);
    expect(cardAmount("Fakturerat")).toMatch(/1\s*200,00/);
    expect(screen.getByText(/varav skapat, ej skickat/).textContent).toMatch(/200,00/);
    expect(screen.queryByText(/9\s*999,00/)).not.toBeInTheDocument();
  });

  it("utan DRAFT visas ingen 'varav'-rad; Betalt och Upparbetat oförändrade", () => {
    workValueOre = 80_000;
    invoices = [{ ...inv("a", 100_000, "PAID"), payments: [{ amount: 100_000 }] }];
    render(<BillingSummary matterId={matterId} runs={[]} />);
    expect(screen.queryByText(/varav skapat/)).not.toBeInTheDocument();
    expect(cardAmount("Betalt")).toMatch(/1\s*000,00/);
    // Upparbetat är netto → default inkl-läge visar +25 %.
    expect(cardAmount("Upparbetat ofakturerat")).toMatch(/1\s*000,00/);
  });

  it("layout: 2×2 som standard, 4 i rad först i bred container", () => {
    render(<BillingSummary matterId={matterId} runs={[]} />);
    const grid = screen.getByTestId("billing-summary-grid");
    expect(grid.className).toContain("grid-cols-2");
    expect(grid.className).toContain("@2xl:grid-cols-4");
    expect(grid.parentElement?.className).toContain("@container");
    expect(grid.children).toHaveLength(4);
  });
});
