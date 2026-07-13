/**
 * Integration för den kronologiska seedningen (#880): populate(kärnentiteter) +
 * runSimulation mot ett git-target (in-memory). Speglar generateInto — verifierar
 * att simuleringen faktiskt skapar tid/dokument/fakturor per ärende, kronologiskt,
 * med inkommande dokument och kredit vid överfakturering.
 */

import { describe, it, expect } from "vitest-compat";
import { userRoleSchema } from "@/lib/shared/schemas/enums";
import { asId } from "@/lib/shared/schemas/ids";
import { createGitTarget } from "../../tooling/demo-generator/backend-target";
import { createIdTranslator, translateSeed } from "../../tooling/demo-generator/id-translator";
import { populate } from "../../tooling/demo-generator/populate";
import { runSimulation } from "../../tooling/demo-generator/simulate/orchestrate";
import type { RunCtx } from "../../tooling/demo-generator/simulate/runner";
import { buildSeed } from "../../tooling/scripts/seed-data";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

describe("runSimulation (#880 integration)", () => {
  it("seedar kronologiskt per ärende: tid, in/ut-dokument, fakturor + kredit", async () => {
    const seed = translateSeed(buildSeed(), createIdTranslator()) as Any;
    const orgId = String(seed.organizations[0].id);
    const admin = { id: asId<"UserId">("gen"), email: "g@a.se", name: "G", role: userRoleSchema.parse("ADMIN"), organizationId: asId<"OrganizationId">(orgId) };
    const target = createGitTarget({ principal: admin, writeBack: async () => {} });
    const coreSeed = { ...seed, matters: seed.matters.map((m: Any) => ({ ...m, status: "ACTIVE" })), timeEntries: [], expenses: [], matterContacts: [], documents: [], serviceNotes: [] };
    await populate(target.caller, coreSeed);

    const ctx: RunCtx = { c: target.caller, res: { invoices: 0, documents: 0, timeEntries: 0, notes: 0, credits: 0 } };
    await runSimulation(ctx, seed);

    // Simuleringen skapade faktiskt saker (fångar "0 av allt"-regressionen).
    expect(ctx.res.timeEntries).toBeGreaterThan(10);
    expect(ctx.res.invoices).toBeGreaterThan(5);
    expect(ctx.res.documents).toBeGreaterThan(5);
    expect(ctx.res.credits).toBeGreaterThanOrEqual(1); // rättshjälp varierande → överfakturerad → kredit

    // Något dokument är INKOMMANDE (inkommande dok skapas per scenario).
    const c = target.caller as Any;
    const mres = await c.matter.list({});
    const matters = mres.matters ?? mres.items ?? mres;
    const rh = matters.find((m: Any) => m.paymentMethod === "RATTSHJALP" && m.matterNumber === "2026-0020");
    expect(rh, "varierande-rättshjälp-ärendet finns").toBeTruthy();
    const docs = await c.document.list({ matterId: rh.id, folderId: null, pageSize: 100 });
    const list = docs.documents ?? docs;
    expect(list.some((d: Any) => d.direction === "INKOMMANDE")).toBe(true);
    expect(list.some((d: Any) => d.direction === "UTGAENDE")).toBe(true);

    // Ärendet har flera tidsposter (kronologin i sig täcks av runner-enhetstestet).
    const te = await c.timeEntry.list({ matterId: rh.id, pageSize: 100 });
    const teRows = te.timeEntries ?? te.items ?? te.entries ?? (Array.isArray(te) ? te : []);
    expect(teRows.length).toBeGreaterThan(2);

    // Regression: ärendet ska ha kontakter (inkl KLIENT), tjänsteanteckningar och
    // utlägg — simuleringen återskapar dem kronologiskt (annars tomma i demon).
    const full = await c.matter.getById({ id: rh.id });
    const contactRows = full.contacts ?? full.matterContacts ?? [];
    expect(contactRows.some((x: Any) => x.role === "KLIENT")).toBe(true);
    const notes = await c.serviceNote.list({ matterId: rh.id });
    expect((notes.serviceNotes ?? notes).length).toBeGreaterThan(0);
    const exp = await c.expense.list({ matterId: rh.id, pageSize: 100 });
    expect((exp.expenses ?? exp.items ?? exp).length).toBeGreaterThan(0);
  });
});
