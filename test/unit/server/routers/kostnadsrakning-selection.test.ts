/**
 * Kostnadsräkningen på ett urval av poster (#1889).
 *
 * `billingRun.createKostnadsrakning` tar, som `createFinal`, de valfria fälten
 * `timeEntryIds` och `expenseIds`: bara de valda yrkas och fryses, ovalda står
 * kvar i förslaget. Utan fälten tas allt ofryst, som förut. Och dokumentets
 * yrkande, byggt på samma poster, är körningens belopp (#1255).
 *
 * Körs mot en riktig in-memory-store genom hela routern, så repo-reglerna är med.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";
import { kostnadsrakningClaimInclVat, type KrClaimInput } from "@/lib/shared/kostnadsrakning";
import { asId } from "@/lib/shared/schemas/ids";

const PRINCIPAL: Principal = {
  id: asId<"UserId">("u-1"), email: "a@x", name: "Anna", role: "ADMIN", organizationId: asId<"OrganizationId">("org-1"),
};
const MATTER = asId<"MatterId">("m-1");
const NOW = new Date("2026-10-15T12:00:00.000Z");
const HUF = { hufStart: "2026-10-14T09:00:00.000Z", hufEnd: "2026-10-14T10:35:00.000Z" }; // 95 min
const REJECTED = { code: "BAD_REQUEST", message: "Någon vald post är redan fakturerad eller tillhör annat ärende." };

type Method = "OFFENTLIGT_UPPDRAG" | "RATTSHJALP";

/** Två arbetsposter, en förhandlingspost och två utlägg (och med `withBilled` ett
 *  redan fakturerat utlägg) i ett ärende med `method`. */
function setup(method: Method = "OFFENTLIGT_UPPDRAG", isTaxe = false, withBilled = false) {
  const base = { organizationId: "org-1", userId: "u-1", matterId: MATTER, billable: true };
  const ds = new DemoDataStore({
    organizations: [{ id: "org-1", name: "X" }],
    matters: [{
      id: MATTER, organizationId: "org-1", matterNumber: "2026-0042", title: "Mål", status: "ACTIVE",
      paymentMethod: method, isTaxeArende: isTaxe, taxaLevel: 1, clientShareBips: method === "RATTSHJALP" ? 1000 : 0, createdAt: new Date(),
    }],
    users: [{ id: "u-1", organizationId: "org-1", email: "a@x", name: "Anna", role: "ADMIN" }],
    timeEntries: [
      { ...base, id: "te-1", date: new Date("2026-09-01T10:00:00.000Z"), minutes: 120, description: "Inläsning", hourlyRate: 250_000, kind: "ARBETE" },
      { ...base, id: "te-2", date: new Date("2026-10-01T10:00:00.000Z"), minutes: 90, description: "Möte", hourlyRate: 250_000, kind: "ARBETE" },
      { ...base, id: "te-h", date: new Date("2026-10-14T10:00:00.000Z"), minutes: 95, description: "Förhandling", hourlyRate: 250_000, kind: "FORHANDLING" },
    ],
    expenses: [
      { ...base, id: "ex-1", date: new Date("2026-09-02T10:00:00.000Z"), amount: 50_000, description: "Resa", vatRate: 0, vatIncluded: false },
      { ...base, id: "ex-2", date: new Date("2026-10-02T10:00:00.000Z"), amount: 30_000, description: "Kopior", vatRate: 0, vatIncluded: false },
      ...(withBilled ? [{ ...base, id: "ex-billed", date: new Date("2026-08-02T10:00:00.000Z"), amount: 10_000, description: "Fakturerad", invoiceId: "inv-old" }] : []),
    ],
    invoices: withBilled ? [{ id: "inv-old", matterId: MATTER, amount: 10_000, invoiceDate: new Date("2026-08-05"), status: "SENT", invoiceType: "STANDARD" }] : [],
  }, async () => { /* writable: noop write-back */ });
  return appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL }));
}

type Caller = ReturnType<typeof setup>;

async function frozenIds(caller: Caller): Promise<string[]> {
  const { entries } = await caller.timeEntry.list({ matterId: MATTER, pageSize: 100 });
  const { expenses } = await caller.expense.list({ matterId: MATTER });
  return [...entries, ...expenses].filter((p) => p.frozenAt).map((p) => p.id).sort();
}

async function proposalIds(caller: Caller): Promise<string[]> {
  const p = await caller.billingRun.proposal({ matterId: MATTER });
  return [...p.timeEntries, ...p.expenses].map((x) => x.id).sort();
}

beforeEach(() => { vi.setSystemTime(NOW); });
afterEach(() => { vi.setSystemTime(); });

describe("createKostnadsrakning med urval (#1889)", () => {
  it("bara de valda fryses, också förhandlingsposten; ovalda står kvar i förslaget", async () => {
    const caller = setup();
    await caller.billingRun.createKostnadsrakning({
      matterId: MATTER, ...HUF, isTaxeArende: false, timeEntryIds: [asId("te-2"), asId("te-h")], expenseIds: [asId("ex-2")],
    });
    expect(await frozenIds(caller)).toEqual(["ex-2", "te-2", "te-h"]);
    expect(await proposalIds(caller)).toEqual(["ex-1", "te-1"]);
  });

  it("bara de valda yrkas: färre poster ger ett lägre yrkande", async () => {
    const all = await setup().billingRun.createKostnadsrakning({ matterId: MATTER, ...HUF, isTaxeArende: false });
    const some = await setup().billingRun.createKostnadsrakning({
      matterId: MATTER, ...HUF, isTaxeArende: false, timeEntryIds: [asId("te-1")], expenseIds: [],
    });
    expect(some.run.workValueOreAtRun).toBeLessThan(all.run.workValueOreAtRun);
    expect(some.run.workValueOreAtRun).toBeGreaterThan(0);
  });

  it("utan urval fryses allt ofryst, som förut", async () => {
    const caller = setup();
    await caller.billingRun.createKostnadsrakning({ matterId: MATTER, ...HUF, isTaxeArende: false });
    expect(await frozenIds(caller)).toEqual(["ex-1", "ex-2", "te-1", "te-2", "te-h"]);
    expect(await proposalIds(caller)).toEqual([]);
  });

  it("en vald post som redan är låst (fakturerad) → BAD_REQUEST, inget fryst", async () => {
    const caller = setup("OFFENTLIGT_UPPDRAG", false, true);
    await expect(caller.billingRun.createKostnadsrakning({ matterId: MATTER, ...HUF, isTaxeArende: false, expenseIds: [asId("ex-billed")] }))
      .rejects.toMatchObject(REJECTED);
    expect(await frozenIds(caller)).toEqual([]);
  });

  it("en post i ett annat ärende eller som inte finns → BAD_REQUEST", async () => {
    const caller = setup();
    await expect(caller.billingRun.createKostnadsrakning({ matterId: MATTER, ...HUF, isTaxeArende: false, timeEntryIds: [asId("finns-ej")] }))
      .rejects.toMatchObject(REJECTED);
    expect(await frozenIds(caller)).toEqual([]);
  });
});

/** Dokumentets yrkande på de valda posterna, med samma indata som dialogerna bygger det av. */
async function documentClaim(caller: Caller, method: Method, isTaxe: boolean, te: string[], ex: string[]): Promise<number> {
  const { entries } = await caller.timeEntry.list({ matterId: MATTER, pageSize: 100 });
  const { expenses } = await caller.expense.list({ matterId: MATTER });
  const timeEntries = entries.filter((e) => te.includes(e.id));
  const chosenExpenses = expenses.filter((e) => ex.includes(e.id));
  const input: KrClaimInput = method === "RATTSHJALP"
    ? { hufStart: NOW, hufEnd: NOW, yrkandeDate: NOW, isTaxeArende: false, expenses: chosenExpenses, timeEntries }
    : {
      hufStart: new Date(HUF.hufStart), hufEnd: new Date(HUF.hufEnd), yrkandeDate: NOW,
      taxaLevel: 1, hasFTax: true, isTaxeArende: isTaxe, expenses: chosenExpenses, timeEntries,
    };
  return kostnadsrakningClaimInclVat(input);
}

describe("dokument = körning för samma urval (#1255, #1889)", () => {
  const cases: ReadonlyArray<{ name: string; method: Method; isTaxe: boolean }> = [
    { name: "taxa", method: "OFFENTLIGT_UPPDRAG", isTaxe: true },
    { name: "löpande räkning", method: "OFFENTLIGT_UPPDRAG", isTaxe: false },
    { name: "rättshjälp", method: "RATTSHJALP", isTaxe: false },
  ];
  it.each(cases)("$name", async ({ method, isTaxe }) => {
    const caller = setup(method, isTaxe);
    const te = ["te-2", "te-h"];
    const ex = ["ex-1"];
    const documented = await documentClaim(caller, method, isTaxe, te, ex);
    const dialog = method === "RATTSHJALP" ? {} : { ...HUF, taxaLevel: 1 as const, isTaxeArende: isTaxe, hasFTax: true };
    const { run } = await caller.billingRun.createKostnadsrakning({
      matterId: MATTER, ...dialog, timeEntryIds: te.map((id) => asId<"TimeEntryId">(id)), expenseIds: ex.map((id) => asId<"ExpenseId">(id)),
    });
    expect(run.workValueOreAtRun).toBe(documented);
    expect(documented).toBeGreaterThan(0);
  });
});
