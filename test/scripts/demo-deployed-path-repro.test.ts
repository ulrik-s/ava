/**
 * REPRO: speglar den deployade demo-vägen (prebakeJoins → ny DemoDataStore)
 * och kör de org-scopade list-queries som var tomma i demon (tidsposter,
 * fakturor, avbetalningsplaner). Om dessa blir tomma här → buggen ligger i
 * prebake/store-bygget, inte i datan.
 */

import { describe, it, expect } from "vitest-compat";
import { prebakeJoins } from "@/lib/shared/demo-source";
import { userRoleSchema } from "@/lib/shared/schemas/enums";
import { asId } from "@/lib/shared/schemas/ids";
import { noopPorts } from "../../src/lib/server/adapters/noop-ports";
import { buildContext } from "../../src/lib/server/build-context";
import { DemoDataStore, type DemoSource } from "../../src/lib/server/data-store/DemoDataStore";
import { appRouter } from "../../src/lib/server/routers/_app";
import { createGitTarget } from "../../tooling/demo-generator/backend-target";
import { populate } from "../../tooling/demo-generator/populate";
import { populateBilling } from "../../tooling/demo-generator/populate-billing";
import { buildSeed } from "../../tooling/scripts/seed-data";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const ENTITY_TO_KEY: Record<string, string> = {
  matter: "matters", contact: "contacts", user: "users", organization: "organizations", office: "offices",
  matterContact: "matterContacts", document: "documents", documentTemplate: "documentTemplates",
  timeEntry: "timeEntries", expense: "expenses", invoice: "invoices", payment: "payments",
  paymentPlan: "paymentPlans", paymentPlanReminder: "paymentPlanReminders", accontoDeduction: "accontoDeductions",
  calendarEvent: "calendarEvents", task: "tasks", conflictCheck: "conflictChecks",
};

const ADMIN = { id: asId<"UserId">("u-anna"), email: "a@a.se", name: "A", role: userRoleSchema.parse("ADMIN"), organizationId: asId<"OrganizationId">("firma-ab") };

describe("deployed-path repro (prebakeJoins + ny store)", () => {
  it("org-scopade list-queries returnerar data", async () => {
    const seed = buildSeed(); // org "firma-ab"
    // Fånga slutgiltig rad per entitet (som manifestet) via writeBack.
    const stores: Record<string, Map<string, Any>> = {};
    const target = createGitTarget({
      principal: ADMIN,
      writeBack: async (e) => {
        if (e.kind === "delete") return;
        const k = ENTITY_TO_KEY[e.entity];
        if (!k) return;
        (stores[k] ??= new Map()).set(String(e.row.id), e.row);
      },
    });
    await populate(target.caller, seed);
    await populateBilling(target.caller, seed);

    // Samla raderna per entitet (som den deployade hydreringen gör sedan #420:
    // `loadDemoSeed` JSON-parsar filerna och bygger en DemoSource direkt, utan
    // projektion-deserialize — schema-validering sker i tRPC-routrarnas input).
    const source: DemoSource = {};
    for (const [, k] of Object.entries(ENTITY_TO_KEY)) {
      const m = stores[k];
      if (!m) continue;
      (source as Any)[k] = [...m.values()];
    }

    const baked = prebakeJoins(source);

    const store = new DemoDataStore(baked);
    const ctx = buildContext({ dataStore: store, ports: noopPorts, principal: ADMIN });
    const caller = appRouter.createCaller(ctx as never) as Any;

    const inv = await caller.invoice.list({});
    const te = await caller.timeEntry.list({ pageSize: 100 });
    const plans = await caller.paymentPlan.list({});
     
    console.log("REPRO counts:", { invoices: inv.length, timeEntries: te.entries.length, paymentPlans: plans.length });

    expect(inv.length).toBeGreaterThan(0);
    expect(te.entries.length).toBeGreaterThan(0);
    expect(plans.length).toBeGreaterThan(0);
  });
});
