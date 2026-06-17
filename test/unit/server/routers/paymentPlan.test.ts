/**
 * paymentPlanRouter — list (+ sökfilter/planHaystack), getById, cancel,
 * recordReminder och scanDueReminders (#23). Kör mot en riktig in-memory-store
 * (repos, ADR 0020); org-scope via planens faktura→ärende.
 */

import { describe, it, expect } from "vitest-compat";
import type { DemoSource } from "@/lib/server/data-store/DemoDataStore";
import type { IDataStore } from "@/lib/server/data-store/IDataStore";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { paymentPlanRouter } from "@/lib/server/routers/paymentPlan";
import { prebakeJoins } from "@/lib/shared/demo-source";

const ORG = "org-a";

function makeCaller(seed: Partial<DemoSource> = {}, orgId = ORG) {
  const source = prebakeJoins({
    matters: [{ id: "m1", organizationId: ORG, matterNumber: "2026-0001", title: "Tvist Lindström" }],
    contacts: [{ id: "klient", organizationId: ORG, name: "Anna Andersson", email: "anna@x.se" }],
    matterContacts: [{ id: "mc1", matterId: "m1", contactId: "klient", role: "KLIENT" }],
    invoices: [{ id: "inv-1", matterId: "m1", amount: 1_000_000, status: "SENT" }],
    payments: [],
    paymentPlans: [],
    paymentPlanReminders: [],
    ...seed,
  } as DemoSource);
  const store = new LocalStore(source, async () => {});
  const repos = buildInMemoryRepositories(store as unknown as IDataStore);
  const ctx = {
    user: { id: "u1", email: "a@b.com", name: "T", role: "LAWYER", organizationId: orgId },
    dataStore: store, repos, orgId,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { caller: paymentPlanRouter.createCaller(ctx as any), store };
}

function src(store: LocalStore): DemoSource {
  return (store as unknown as { source: DemoSource }).source;
}

const plan = (o: Record<string, unknown> = {}) => ({
  id: "pp-1", invoiceId: "inv-1", status: "ACTIVE",
  monthlyAmount: 100_000, dayOfMonth: 15, startDate: "2026-06-01", ...o,
});

describe("paymentPlan.recordReminder", () => {
  it("loggar en påminnelse för en plan i org:en (sentAt → Date)", async () => {
    const { caller, store } = makeCaller({ paymentPlans: [plan()] });
    const res = await caller.recordReminder({
      id: "ppr-1", planId: "pp-1", dueMonth: "2026-03", type: "DUE", sentAt: "2026-03-10T00:00:00Z",
    });
    expect(res.planId).toBe("pp-1");
    expect(res.dueMonth).toBe("2026-03");
    const rem = (src(store).paymentPlanReminders as Array<Record<string, unknown>>)[0]!;
    expect(rem.id).toBe("ppr-1");
    expect(rem.type).toBe("DUE");
    expect(rem.sentAt).toBeInstanceOf(Date);
  });

  it("defaultar sentAt till now() när det utelämnas", async () => {
    const { caller, store } = makeCaller({ paymentPlans: [plan()] });
    await caller.recordReminder({ planId: "pp-1", dueMonth: "2026-04", type: "OVERDUE" });
    expect((src(store).paymentPlanReminders as Array<Record<string, unknown>>)[0]!.sentAt).toBeInstanceOf(Date);
  });

  it("kastar NOT_FOUND när planen inte tillhör org:en", async () => {
    const { caller, store } = makeCaller({ paymentPlans: [plan()] }, "org-b");
    await expect(
      caller.recordReminder({ planId: "pp-1", dueMonth: "2026-03", type: "DUE" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(src(store).paymentPlanReminders).toHaveLength(0);
  });
});

describe("paymentPlan.list", () => {
  it("returnerar alla planer i org:en utan sökterm", async () => {
    const { caller } = makeCaller({
      invoices: [
        { id: "inv-1", matterId: "m1", amount: 1_000_000, status: "SENT" },
        { id: "inv-2", matterId: "m1", amount: 500_000, status: "SENT" },
      ],
      paymentPlans: [plan(), plan({ id: "pp-2", invoiceId: "inv-2" })],
    });
    expect(await caller.list({})).toHaveLength(2);
  });

  it("filtrerar på status när angivet", async () => {
    const { caller } = makeCaller({
      invoices: [
        { id: "inv-1", matterId: "m1", amount: 1, status: "SENT" },
        { id: "inv-2", matterId: "m1", amount: 1, status: "SENT" },
      ],
      paymentPlans: [plan(), plan({ id: "pp-2", invoiceId: "inv-2", status: "COMPLETED" })],
    });
    const res = await caller.list({ status: "COMPLETED" });
    expect(res.map((p) => p.id)).toEqual(["pp-2"]);
  });

  it("söker i ärendenr/titel/klient/anteckningar (planHaystack)", async () => {
    const { caller } = makeCaller({ paymentPlans: [plan()] });
    expect(await caller.list({ search: "lindström" })).toHaveLength(1); // matchar matter-titel
    expect(await caller.list({ search: "saknas-helt" })).toHaveLength(0);
  });

  it("matchar på klientnamn", async () => {
    const { caller } = makeCaller({ paymentPlans: [plan()] });
    expect(await caller.list({ search: "andersson" })).toHaveLength(1);
  });
});

describe("paymentPlan.getById", () => {
  it("returnerar planen (med reminders) när den finns i org:en", async () => {
    const { caller } = makeCaller({ paymentPlans: [plan()] });
    const res = await caller.getById({ id: "pp-1" });
    expect(res.id).toBe("pp-1");
    expect(Array.isArray(res.reminders)).toBe(true);
  });

  it("NOT_FOUND när planen saknas/ej i org", async () => {
    const { caller } = makeCaller({ paymentPlans: [plan()] });
    await expect(caller.getById({ id: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("paymentPlan.cancel", () => {
  it("avbryter en aktiv plan → CANCELLED + invoice tillbaka SENT", async () => {
    const { caller, store } = makeCaller({ paymentPlans: [plan({ status: "ACTIVE" })] });
    expect(await caller.cancel({ planId: "pp-1" })).toEqual({ ok: true });
    const pp = (src(store).paymentPlans as Array<{ id: string; status: string }>).find((p) => p.id === "pp-1")!;
    expect(pp.status).toBe("CANCELLED");
    const inv = (src(store).invoices as Array<{ id: string; status: string }>).find((i) => i.id === "inv-1")!;
    expect(inv.status).toBe("SENT");
  });

  it("NOT_FOUND när planen inte tillhör org:en", async () => {
    const { caller, store } = makeCaller({ paymentPlans: [plan()] }, "org-b");
    await expect(caller.cancel({ planId: "pp-1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((src(store).paymentPlans as Array<{ status: string }>)[0]!.status).toBe("ACTIVE");
  });

  it("BAD_REQUEST när planen inte är ACTIVE", async () => {
    const { caller } = makeCaller({ paymentPlans: [plan({ status: "CANCELLED" })] });
    await expect(caller.cancel({ planId: "pp-1" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("paymentPlan.scanDueReminders (#23)", () => {
  it("genererar en DUE-påminnelse när förfallodagen passerat innevarande månad", async () => {
    const { caller, store } = makeCaller({ paymentPlans: [plan({ startDate: "2026-06-01" })] });
    const res = await caller.scanDueReminders({ asOf: "2026-06-20T00:00:00.000Z" });
    expect(res.scanned).toBe(1);
    expect(res.due).toBe(1);
    expect(res.overdue).toBe(0);
    const rem = (src(store).paymentPlanReminders as Array<Record<string, unknown>>)[0]!;
    expect(rem).toMatchObject({ planId: "pp-1", dueMonth: "2026-06", type: "DUE" });
  });

  it("genererar en OVERDUE-påminnelse för föregående månad", async () => {
    const { caller } = makeCaller({ paymentPlans: [plan({ startDate: "2026-05-01" })] });
    const res = await caller.scanDueReminders({ asOf: "2026-06-20T00:00:00.000Z" });
    expect(res.overdue).toBe(1);
  });

  it("hoppar över redan loggade påminnelser (idempotent)", async () => {
    const { caller, store } = makeCaller({
      paymentPlans: [plan({ startDate: "2026-06-01" })],
      paymentPlanReminders: [{ id: "r0", planId: "pp-1", dueMonth: "2026-06", type: "DUE", sentAt: new Date("2026-06-15") }],
    });
    const res = await caller.scanDueReminders({ asOf: "2026-06-20T00:00:00.000Z" });
    expect(res.due).toBe(0);
    expect(src(store).paymentPlanReminders).toHaveLength(1); // ingen ny
  });

  it("tom org → scanned 0, inga påminnelser", async () => {
    const { caller } = makeCaller();
    expect(await caller.scanDueReminders()).toMatchObject({ scanned: 0, planned: 0, due: 0, overdue: 0 });
  });
});
