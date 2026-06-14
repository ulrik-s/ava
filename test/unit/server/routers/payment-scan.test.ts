/**
 * `paymentPlan.scanDueReminders` (#23) — end-to-end mot riktig DemoDataStore.
 * Verifierar DUE/OVERDUE-generering, att påminnelser loggas, och idempotens.
 */
import { describe, it, expect } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";

const PRINCIPAL: Principal = { id: "u-1", email: "a@x", name: "Anna", role: "ADMIN", organizationId: "org-1" };

function makeCaller(opts: { startDate: string; paidOre?: number }) {
  const ds = new DemoDataStore({
    organizations: [{ id: "org-1", name: "Byrå AB" }],
    matters: [{ id: "m-1", organizationId: "org-1", matterNumber: "2026-0001", title: "Tvist", status: "ACTIVE", createdAt: new Date() }],
    contacts: [{ id: "c-1", organizationId: "org-1", name: "Klient AB", email: "klient@example.se" }],
    matterContacts: [{ id: "mc-1", matterId: "m-1", contactId: "c-1", role: "KLIENT" }],
    invoices: [{ id: "inv-1", organizationId: "org-1", matterId: "m-1", amount: 600000, invoiceType: "STANDARD", status: "INSTALLMENT_PLAN", invoiceDate: new Date() }],
    payments: opts.paidOre != null ? [{ id: "pay-1", invoiceId: "inv-1", amount: opts.paidOre, paidAt: new Date() }] : [],
    paymentPlans: [{ id: "pp-1", invoiceId: "inv-1", monthlyAmount: 50000, dayOfMonth: 10, startDate: opts.startDate, status: "ACTIVE", createdAt: new Date() }],
  }, async () => { /* writable noop */ });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ds, caller: appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL }) as any) };
}

describe("paymentPlan.scanDueReminders", () => {
  it("genererar DUE för innevarande månad + loggar påminnelsen", async () => {
    const { ds, caller } = makeCaller({ startDate: "2026-03-01" });
    const res = await caller.paymentPlan.scanDueReminders({ asOf: "2026-03-10T09:00:00.000Z" });
    expect(res).toMatchObject({ scanned: 1, planned: 1, due: 1, overdue: 0 });
    const reminders = await ds.paymentPlanReminders.findMany({ where: { planId: "pp-1" } });
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({ planId: "pp-1", dueMonth: "2026-03", type: "DUE" });
  });

  it("genererar OVERDUE för föregående månad (eskalering)", async () => {
    const { caller } = makeCaller({ startDate: "2026-01-15" });
    const res = await caller.paymentPlan.scanDueReminders({ asOf: "2026-03-10T09:00:00.000Z" });
    expect(res).toMatchObject({ planned: 1, overdue: 1, due: 0 });
  });

  it("idempotent: andra scan samma dag genererar inga nya", async () => {
    const { caller } = makeCaller({ startDate: "2026-03-01" });
    await caller.paymentPlan.scanDueReminders({ asOf: "2026-03-10T09:00:00.000Z" });
    const second = await caller.paymentPlan.scanDueReminders({ asOf: "2026-03-10T09:00:00.000Z" });
    expect(second.planned).toBe(0);
  });

  it("betald plan (remaining <= 0) → inga påminnelser", async () => {
    const { caller } = makeCaller({ startDate: "2026-03-01", paidOre: 600000 });
    const res = await caller.paymentPlan.scanDueReminders({ asOf: "2026-03-10T09:00:00.000Z" });
    expect(res.planned).toBe(0);
  });

  it("före dayOfMonth (och ingen föreg. månad) → inga påminnelser", async () => {
    const { caller } = makeCaller({ startDate: "2026-03-01" });
    const res = await caller.paymentPlan.scanDueReminders({ asOf: "2026-03-05T09:00:00.000Z" });
    expect(res.planned).toBe(0);
  });

  it("saknad KLIENT-kontakt → scannar ändå (tom recipient i payloaden)", async () => {
    // Ingen matterContact/KLIENT → resolveRecipient faller tillbaka på "".
    const ds = new DemoDataStore({
      organizations: [{ id: "org-1", name: "Byrå AB" }],
      matters: [{ id: "m-1", organizationId: "org-1", matterNumber: "2026-0001", title: "Tvist", status: "ACTIVE", createdAt: new Date() }],
      invoices: [{ id: "inv-1", organizationId: "org-1", matterId: "m-1", amount: 600000, invoiceType: "STANDARD", status: "INSTALLMENT_PLAN", invoiceDate: new Date() }],
      paymentPlans: [{ id: "pp-1", invoiceId: "inv-1", monthlyAmount: 50000, dayOfMonth: 10, startDate: "2026-03-01", status: "ACTIVE", createdAt: new Date() }],
    }, async () => { /* noop */ });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const caller = appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL }) as any);
    const res = await caller.paymentPlan.scanDueReminders({ asOf: "2026-03-10T09:00:00.000Z" });
    expect(res).toMatchObject({ planned: 1, due: 1 });
    const reminders = await ds.paymentPlanReminders.findMany({ where: { planId: "pp-1" } });
    expect(reminders[0]).toMatchObject({ type: "DUE" });
  });
});
