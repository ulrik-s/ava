/**
 * Radavrundningen gäller bara NYA fakturor (#1438). En faktura utfärdad före
 * #1438 bär inget `amountRounding` och är avrundad på öret: dess belopp räknas
 * aldrig om, och specifikationen som dokumentet renderas ur (t.ex. bilagan vid
 * ett senare utskick) räknas med öresavrundning — så den visar exakt de rader
 * som skickades.
 */
import { describe, expect, it } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";
import { asId } from "@/lib/shared/schemas/ids";

const PRINCIPAL: Principal = {
  id: asId<"UserId">("u-1"), email: "a@x", name: "Anna", role: "ADMIN", organizationId: asId<"OrganizationId">("org-1"),
};

/** 7 min à 1 000 kr/h = 116,666… kr — en rad som skiljer öre från kronor. */
const ENTRY = { minutes: 7, hourlyRate: 100_000 };

function world(invoice: Record<string, unknown>, matter: Record<string, unknown> = {}) {
  const ds = new DemoDataStore({
    organizations: [{ id: "org-1", name: "X" }],
    users: [{ id: "u-1", organizationId: "org-1", email: "a@x", name: "Anna", role: "ADMIN" }],
    matters: [{ id: "m-1", organizationId: "org-1", matterNumber: "2026-0001", title: "T", status: "ACTIVE", paymentMethod: "PRIVAT", createdAt: new Date(), ...matter }],
    invoices: [{
      id: "inv-1", matterId: "m-1", invoiceNumber: "F-2026-0001", invoiceType: "FINAL", status: "SENT",
      invoiceDate: new Date("2026-09-01"), ...invoice,
    }],
    timeEntries: [{ id: "te-1", organizationId: "org-1", userId: "u-1", matterId: "m-1", date: new Date("2026-08-01"), description: "Brev", billable: true, invoiceId: "inv-1", ...ENTRY }],
    expenses: [{ id: "ex-1", organizationId: "org-1", userId: "u-1", matterId: "m-1", date: new Date("2026-08-02"), amount: 4_999, description: "Porto", billable: true, vatRate: 0, vatIncluded: false, kind: "EXPENSE", invoiceId: "inv-1" }],
  }, async () => {});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL }) as any);
}

describe("invoiceSpecification följer fakturans EGET avrundningssätt (#1438)", () => {
  it("en äldre faktura (utan fält) specificeras på öret, som när den skapades", async () => {
    // Arvode 11 667 + moms 2 917 + utlägg 4 999 + moms 1 250 = 20 833 öre.
    const c = world({ amount: 20_833, vatOre: 4_167 });
    const spec = await c.billingRun.invoiceSpecification({ matterId: "m-1", invoiceId: "inv-1" });
    expect(spec.timeLines[0]!.amountOre).toBe(11_667);
    expect(spec.arvodeVatOre).toBe(2_917);
    expect(spec.expenseLines[0]).toMatchObject({ netOre: 4_999, grossOre: 6_249 });
    expect(spec.expensesVatOre).toBe(1_250);
    expect(spec.adjustmentOre).toBe(0);
  });

  it("en ny faktura specificeras i hela kronor per rad", async () => {
    // Arvode 117 + moms 29 (29,25) + utlägg 50 (49,99) + moms 13 (12,50) = 209 kr.
    const c = world({ amount: 20_900, vatOre: 4_200, amountRounding: "KRONOR" });
    const spec = await c.billingRun.invoiceSpecification({ matterId: "m-1", invoiceId: "inv-1" });
    expect(spec.timeLines[0]!.amountOre).toBe(11_700);
    expect(spec.arvodeVatOre).toBe(2_900);
    expect(spec.expenseLines[0]).toMatchObject({ netOre: 5_000, grossOre: 6_300 });
    expect(spec.expensesVatOre).toBe(1_300);
    expect(spec.adjustmentOre).toBe(0);
  });
});

describe("kreditering speglar originalets avrundning", () => {
  it("en äldre faktura krediteras på öret — beloppet räknas aldrig om", async () => {
    const c = world({ amount: 20_833, vatOre: 4_167 });
    const credit = await c.invoice.createCredit({ invoiceId: asId<"InvoiceId">("inv-1") });
    expect(credit.amount).toBe(-20_833);
    expect(credit.amountRounding ?? null).toBeNull();
  });

  it("en ny faktura krediteras i hela kronor", async () => {
    const c = world({ amount: 20_900, vatOre: 4_200, amountRounding: "KRONOR" });
    const credit = await c.invoice.createCredit({ invoiceId: asId<"InvoiceId">("inv-1") });
    expect(credit.amount).toBe(-20_900);
    expect(credit.amountRounding).toBe("KRONOR");
  });
});

describe("domstolens och försäkringens belopp tas som de är", () => {
  it("faktura efter dom: yrkandet + domens prutning med ören, momsen följer med", async () => {
    const c = world({ amount: 0 }, { paymentMethod: "OFFENTLIGT_UPPDRAG" });
    const { run } = await c.billingRun.createKostnadsrakning({ matterId: "m-1" });
    // Domstolen prutar 123,45 kr — beloppet tas som det är.
    await c.billingRun.recordKostnadsrakningBeslut({ billingRunId: run.id, awardedOre: (run.workValueOreAtRun ?? 0) - 12_345, prutningOre: -12_345 });
    const { invoice } = await c.billingRun.setVerdict({ billingRunId: run.id });
    expect(invoice.amount).toBe((run.workValueOreAtRun ?? 0) - 12_345);
    expect(invoice.amountRounding).toBe("KRONOR");
    // Momsen sparas så verifikatet bokför samma tal: nettot i hela kronor, momsen resten.
    expect(((invoice.amount - (invoice.vatOre ?? 0)) % 100)).toBe(0);
  });
});
