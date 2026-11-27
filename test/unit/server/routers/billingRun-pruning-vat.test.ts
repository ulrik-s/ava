/**
 * Prutningens beloppsflytt utgår från fakturans moms (#1807).
 *
 * `recordInsurerPruning` flyttar arvode mellan slutregleringens två fakturor.
 * Momsen räknas från `invoiceVatOre` (inte från 0), och uppdelningen justeras
 * bara när fakturan har en. Fyra fall: med uppdelning (som förr), med `vatOre`
 * men utan uppdelning, utan båda, och med tom uppdelning. I varje fall stämmer
 * den sparade momsen med fakturans moms och med verifikatets.
 */
import { describe, it, expect } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";
import { buildSemanticVoucher, type SemanticVoucherRow, type VoucherRole } from "@/lib/shared/accounting/semantic-voucher";
import { invoiceVatOre } from "@/lib/shared/billing/invoice-vat";
import type { Invoice } from "@/lib/shared/schemas/billing";
import { asId } from "@/lib/shared/schemas/ids";

const PRINCIPAL: Principal = {
  id: asId<"UserId">("u-1"), email: "a@x", name: "Anna", role: "ADMIN", organizationId: asId<"OrganizationId">("org-1"),
};

const PRUNED_NET = 100_000;
const PRUNED_VAT = 25_000;

function setup(): { ds: DemoDataStore; caller: ReturnType<typeof appRouter.createCaller> } {
  const ds = new DemoDataStore({
    organizations: [{ id: "org-1", name: "X" }],
    matters: [{ id: "m-1", organizationId: "org-1", matterNumber: "2026-0001", title: "T", status: "ACTIVE", responsibleLawyerId: "u-1", paymentMethod: "RATTSSKYDD", clientShareBips: 2000, createdAt: new Date() }],
    users: [{ id: "u-1", organizationId: "org-1", email: "a@x", name: "Anna", role: "ADMIN", hourlyRates: { ARBETE: 300000 } }],
    timeEntries: [{ id: "te-1", organizationId: "org-1", userId: "u-1", matterId: "m-1", date: new Date(), minutes: 120, description: "M", hourlyRate: 200000, billable: true }],
  }, async () => {});
  return { ds, caller: appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL })) };
}

type VatFields = Pick<Invoice, "vatOre" | "vatBreakdown">;

/** Gör slutregleringens fakturor till "äldre" fakturor med de givna momsfälten. */
async function makeLegacy(ds: DemoDataStore, invoices: readonly Invoice[], fields: VatFields): Promise<void> {
  for (const inv of invoices) {
    await ds.invoices.update({ where: { id: inv.id }, data: fields });
  }
}

const signedMoms = (rows: readonly SemanticVoucherRow[]): number =>
  rows.filter((r) => r.role === "momsUtgaende").reduce((s, r) => s + r.credit - r.debit, 0);

const rowFor = (rows: readonly SemanticVoucherRow[], role: VoucherRole): SemanticVoucherRow | undefined =>
  rows.find((r) => r.role === role);

/** Fakturans moms, verifikatets moms och kundfordran stämmer med det sparade. */
function expectConsistent(invoice: Invoice): void {
  expect(invoiceVatOre(invoice)).toBe(invoice.vatOre ?? Number.NaN);
  const voucher = buildSemanticVoucher({
    amount: invoice.amount, vatOre: invoice.vatOre ?? null, vatBreakdown: invoice.vatBreakdown ?? null, invoiceDate: invoice.invoiceDate,
  });
  expect(signedMoms(voucher.rows)).toBe(invoice.vatOre ?? Number.NaN);
  const debit = voucher.rows.reduce((s, r) => s + r.debit, 0);
  const credit = voucher.rows.reduce((s, r) => s + r.credit, 0);
  expect(debit).toBe(credit);
  const kund = rowFor(voucher.rows, "kundfordran");
  expect((kund?.debit ?? 0) + (kund?.credit ?? 0)).toBe(Math.abs(invoice.amount));
}

async function settle(): Promise<{ ds: DemoDataStore; caller: ReturnType<typeof appRouter.createCaller>; payer: Invoice; client: Invoice }> {
  const { ds, caller } = setup();
  const settled = await caller.billingRun.settleCoverage({ matterId: "m-1", payerRecipient: "FORSAKRING" });
  return { ds, caller, payer: settled.payerInvoice, client: settled.clientInvoice };
}

describe("recordInsurerPruning — momsen utgår från fakturans moms (#1807)", () => {
  it("1. med uppdelning: arvodets 25 %-rad justeras och resultatet är detsamma som förr", async () => {
    const { caller, payer, client } = await settle();
    expect(payer.vatBreakdown?.length ?? 0).toBeGreaterThan(0);
    const res = await caller.billingRun.recordInsurerPruning({ matterId: "m-1", prunedNetOre: PRUNED_NET });
    // Som före #1807: vatOre + delta, och uppdelningens arvodesrad bär deltat.
    expect(res.payerInvoice.vatOre).toBe((payer.vatOre ?? 0) - PRUNED_VAT);
    expect(res.clientInvoice.vatOre).toBe((client.vatOre ?? 0) + PRUNED_VAT);
    const arvode = (inv: Invoice) => inv.vatBreakdown?.find((l) => l.kind === "arvode" && l.vatRate === 2500);
    expect(arvode(res.payerInvoice)?.netOre).toBe((arvode(payer)?.netOre ?? 0) - PRUNED_NET);
    expect(res.payerInvoice.vatBreakdown).toHaveLength(payer.vatBreakdown?.length ?? 0);
    expectConsistent(res.payerInvoice);
    expectConsistent(res.clientInvoice);
  });

  it("2. med vatOre men utan uppdelning: vatOre + delta, och ingen uppdelning skapas", async () => {
    const { ds, caller, payer, client } = await settle();
    await makeLegacy(ds, [payer, client], { vatOre: 40_000, vatBreakdown: null });
    const res = await caller.billingRun.recordInsurerPruning({ matterId: "m-1", prunedNetOre: PRUNED_NET });
    expect(res.payerInvoice.vatOre).toBe(40_000 - PRUNED_VAT);
    expect(res.clientInvoice.vatOre).toBe(40_000 + PRUNED_VAT);
    expect(res.payerInvoice.vatBreakdown ?? null).toBeNull();
    expect(res.clientInvoice.vatBreakdown ?? null).toBeNull();
    expectConsistent(res.payerInvoice);
    expectConsistent(res.clientInvoice);
  });

  it("3. utan vatOre och uppdelning: basen är 25 %-splitten av beloppet, inte 0", async () => {
    const { ds, caller, payer, client } = await settle();
    await makeLegacy(ds, [payer, client], { vatOre: null, vatBreakdown: null });
    const base = (inv: Invoice): number => invoiceVatOre({ amount: inv.amount });
    const res = await caller.billingRun.recordInsurerPruning({ matterId: "m-1", prunedNetOre: PRUNED_NET });
    expect(res.payerInvoice.vatOre).toBe(base(payer) - PRUNED_VAT);
    expect(res.clientInvoice.vatOre).toBe(base(client) + PRUNED_VAT);
    expect(res.payerInvoice.vatBreakdown ?? null).toBeNull();
    expectConsistent(res.payerInvoice);
    expectConsistent(res.clientInvoice);
  });

  it("4. med tom uppdelning: listan lämnas tom och vatOre bär momsen", async () => {
    const { ds, caller, payer, client } = await settle();
    await makeLegacy(ds, [payer, client], { vatOre: 40_000, vatBreakdown: [] });
    const res = await caller.billingRun.recordInsurerPruning({ matterId: "m-1", prunedNetOre: PRUNED_NET });
    expect(res.payerInvoice.vatOre).toBe(40_000 - PRUNED_VAT);
    expect(res.clientInvoice.vatOre).toBe(40_000 + PRUNED_VAT);
    expect(res.payerInvoice.vatBreakdown).toEqual([]);
    expect(res.clientInvoice.vatBreakdown).toEqual([]);
    expectConsistent(res.payerInvoice);
    expectConsistent(res.clientInvoice);
  });
});
