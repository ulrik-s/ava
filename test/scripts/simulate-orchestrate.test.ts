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
import { emptyRunResult, type RunCtx } from "../../tooling/demo-generator/simulate/runner";
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

    const ctx: RunCtx = { c: target.caller, res: emptyRunResult() };
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
    // `document.tree`, inte `document.list({folderId: null})`: sedan #985 filas
    // varje dokument i en mapp, så ROT-listningen är tom. Trädet är dessutom vad
    // UI:t faktiskt läser — båda dokumentvyerna bygger på `tree.data`.
    const list = (await c.document.tree({ matterId: rh.id })).documents as Any[];
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

    // #891: 2026-0020 spänner över ett årsskifte, innehåller tidsspillan och
    // slutregleras retroaktivt på nya normen (klient- + domstolsfaktura).
    const teAll = await c.timeEntry.list({ matterId: rh.id, pageSize: 100 });
    const teRows2 = teAll.timeEntries ?? teAll.items ?? teAll.entries ?? (Array.isArray(teAll) ? teAll : []);
    const years = new Set(teRows2.map((t: Any) => new Date(t.date).getFullYear()));
    expect(years.size).toBeGreaterThan(1); // korsar årsgränsen
    expect(teRows2.some((t: Any) => t.kind === "TIDSSPILLAN")).toBe(true);
    const settlementRuns = (await c.billingRun.list({ matterId: rh.id })).runs as Any[];
    const recips = new Set(settlementRuns.filter((r) => r.type === "FINAL").map((r) => r.recipient));
    expect(recips.has("KLIENT")).toBe(true);
    expect(recips.has("DOMSTOL")).toBe(true);
  });

  /**
   * #982: simuleringen ersatte `populate-billing.ts` men tog inte över dess
   * faktura-livscykler, så demon hade noll avbetalningsplaner och noll
   * avskrivningar. Det upptäcktes först av ett e2e-test — inget steg sa något.
   * Testet nedan är den saknade grinden: det påstår om DEMONS DATA, inte om
   * scenariomallen, att varje tillstånd faktiskt uppstår.
   */
  it("privatärendenas livscykler ger planer i alla tre tillstånd + en kundförlust", async () => {
    const seed = translateSeed(buildSeed(), createIdTranslator()) as Any;
    const orgId = String(seed.organizations[0].id);
    const admin = { id: asId<"UserId">("gen"), email: "g@a.se", name: "G", role: userRoleSchema.parse("ADMIN"), organizationId: asId<"OrganizationId">(orgId) };
    const target = createGitTarget({ principal: admin, writeBack: async () => {} });
    const coreSeed = { ...seed, matters: seed.matters.map((m: Any) => ({ ...m, status: "ACTIVE" })), timeEntries: [], expenses: [], matterContacts: [], documents: [], serviceNotes: [] };
    await populate(target.caller, coreSeed);

    const ctx: RunCtx = { c: target.caller, res: emptyRunResult() };
    await runSimulation(ctx, seed);

    const c = target.caller as Any;
    const plans = await c.paymentPlan.list({});
    const statuses = new Set((plans as Any[]).map((p) => p.status));
    // Cykeln i `privat.ts` är sex lång och seeden har fler privatärenden än så,
    // så alla tre tillstånden ska förekomma. Slår detta fel har antingen cykeln
    // ändrats eller antalet privatärenden fallit under sex.
    expect(statuses.has("ACTIVE"), "aktiv plan").toBe(true);
    expect(statuses.has("COMPLETED"), "slutförd plan").toBe(true);
    expect(statuses.has("CANCELLED"), "avbruten plan").toBe(true);
    expect(ctx.res.reminders, "påminnelser skickade").toBeGreaterThan(0);

    // Kundförlusten stänger sin faktura som BAD_DEBT (ADR 0007).
    expect(ctx.res.writeOffs).toBeGreaterThan(0);
    const invoices = await c.invoice.list({}) as Any[];
    expect(invoices.some((i) => i.status === "BAD_DEBT"), "avskriven faktura").toBe(true);
    // …och en plan-faktura står som INSTALLMENT_PLAN, inte som vanlig SENT.
    expect(invoices.some((i) => i.status === "INSTALLMENT_PLAN"), "faktura med plan").toBe(true);
  });

  /**
   * #985: dokumentmappar och utskickshistorik. Loadern saknade matchers för
   * båda, men bakom det låg att simuleringen aldrig skapade dem — varje dokument
   * låg i roten och fakturans utskickshistorik var tom. Testet påstår om DEMONS
   * DATA att strukturen finns, inte om scenariomallen.
   */
  it("dokument filas i mappar (inkl. nästlade) och skickade fakturor får utskickshistorik", async () => {
    const seed = translateSeed(buildSeed(), createIdTranslator()) as Any;
    const orgId = String(seed.organizations[0].id);
    const admin = { id: asId<"UserId">("gen"), email: "g@a.se", name: "G", role: userRoleSchema.parse("ADMIN"), organizationId: asId<"OrganizationId">(orgId) };
    const target = createGitTarget({ principal: admin, writeBack: async () => {} });
    const coreSeed = { ...seed, matters: seed.matters.map((m: Any) => ({ ...m, status: "ACTIVE" })), timeEntries: [], expenses: [], matterContacts: [], documents: [], serviceNotes: [] };
    await populate(target.caller, coreSeed);

    const ctx: RunCtx = { c: target.caller, res: emptyRunResult() };
    await runSimulation(ctx, seed);

    const c = target.caller as Any;
    expect(ctx.res.folders, "mappar skapade").toBeGreaterThan(0);
    expect(ctx.res.dispatches, "utskick registrerade").toBeGreaterThan(0);

    // Ett ärende med domstolsdokument ska ha Domstol/ med Domar under sig, och
    // inga dokument kvar i roten.
    const matters = (await c.matter.list({})).matters as Any[];
    const withCourt = matters.find((m: Any) => String(m.paymentMethod) === "OFFENTLIGT_UPPDRAG") ?? matters[0];
    const tree = await c.document.tree({ matterId: withCourt.id });
    const folders = tree.folders as Array<{ id: string; name: string; parentId: string | null }>;
    expect(folders.length, "ärendet har mappar").toBeGreaterThan(0);
    const nested = folders.find((f) => f.parentId !== null);
    expect(nested, "minst en nästlad mapp — annars ser trädet ut som en platt lista").toBeTruthy();
    expect(folders.some((f) => f.id === nested?.parentId), "den nästlade mappens förälder finns").toBe(true);

    // Varje dokument har en mapp — och rot-listningen är följaktligen tom.
    const all = tree.documents as Array<{ folderId: string | null }>;
    expect(all.length, "ärendet har dokument").toBeGreaterThan(0);
    expect(all.every((d) => d.folderId !== null), "inget dokument ligger kvar i roten").toBe(true);
    const rootListing = await c.document.list({ matterId: withCourt.id, folderId: null, pageSize: 100 });
    expect((rootListing.documents ?? rootListing).length, "rot-mappen är tom").toBe(0);
  });

  /**
   * #988: `SuggestionsPanel` och `EventsPanel` stod tomma i ALLA tier eftersom
   * ingenting skapade raderna. Nu extraherar seedningen parter och kallelser ur
   * dokumentens text. Testet påstår om DEMONS DATA att panelerna har något att
   * visa — och att förslagen går att koppla till ett ärende, vilket är vad
   * panelerna frågar efter.
   */
  it("dokumenttext ger kontakt- och händelseförslag som panelerna kan visa", async () => {
    const seed = translateSeed(buildSeed(), createIdTranslator()) as Any;
    const orgId = String(seed.organizations[0].id);
    const admin = { id: asId<"UserId">("gen"), email: "g@a.se", name: "G", role: userRoleSchema.parse("ADMIN"), organizationId: asId<"OrganizationId">(orgId) };
    const target = createGitTarget({ principal: admin, writeBack: async () => {} });
    const coreSeed = { ...seed, matters: seed.matters.map((m: Any) => ({ ...m, status: "ACTIVE" })), timeEntries: [], expenses: [], matterContacts: [], documents: [], serviceNotes: [] };
    await populate(target.caller, coreSeed);

    const ctx: RunCtx = { c: target.caller, res: emptyRunResult() };
    await runSimulation(ctx, seed);

    expect(ctx.res.partySuggestions, "kontaktförslag skapade").toBeGreaterThan(0);
    expect(ctx.res.eventSuggestions, "händelseförslag skapade").toBeGreaterThan(0);

    // Panelerna läser per ÄRENDE — hittar de inget där spelar det ingen roll
    // hur många rader som skapats.
    const c = target.caller as Any;
    const matters = (await c.matter.list({})).matters as Any[];
    const groups = await Promise.all(matters.map((m: Any) => c.document.pendingSuggestionsGrouped({ matterId: m.id })));
    expect(groups.some((g: Any) => (g.groups ?? g).length > 0), "något ärende har kontaktförslag").toBe(true);

    const events = await Promise.all(matters.map((m: Any) => c.document.events({ matterId: m.id })));
    expect(events.some((e: Any) => (e.events ?? e).length > 0), "något ärende har händelseförslag").toBe(true);
  });
});
