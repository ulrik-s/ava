/**
 * Demon ska visa PRUTNING i BÅDA regimerna (#936) — de skiljer sig i vem som bär den:
 *   • rättshjälp  — domstolen sätter ned beloppet, BYRÅN bär mellanskillnaden
 *   • rättsskydd  — försäkringen prutar, KLIENTEN bär den (byrån blir hel)
 * Utan detta test kan nedsättningen tyst falla ur scenarierna igen.
 */

import { describe, it, expect } from "vitest-compat";
import type { SimMatter } from "../../tooling/demo-generator/simulate/events";
import { emptyRunResult, runScenario, type RunCtx } from "../../tooling/demo-generator/simulate/runner";
import { buildScenario } from "../../tooling/demo-generator/simulate/scenarios";
import { buildRattshjalpScenario } from "../../tooling/demo-generator/simulate/scenarios/rattshjalp";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** Caller-stub som spelar in mutationerna (samma mönster som simulate-runner-testet). */
function recordingCaller(): { c: Any; calls: Array<{ method: string; args: Any }> } {
  const calls: Array<{ method: string; args: Any }> = [];
  const rec = (method: string) => async (args: Any) => {
    calls.push({ method, args });
    if (method === "billingRun.createAcconto") return { run: { id: "run" }, invoice: { id: `inv-${calls.length}` } };
    if (method === "billingRun.createKostnadsrakning") return { run: { id: "kr", workValueOreAtRun: 5_000_000 } };
    if (method === "billingRun.createFinal") return { invoice: { id: "fin", amount: 100_000 } };
    if (method === "billingRun.settleCoverage") return { clientInvoice: {}, payerInvoice: {} };
    if (method === "document.tree") return { folders: [], documents: [] };
    if (method === "document.suggestFromText") return { parties: 0, events: 0 };
    if (method === "document.createFolder") return { id: `folder-${calls.length}` };
    return {};
  };
  const c = {
    matter: { addContact: rec("matter.addContact"), update: rec("matter.update") },
    timeEntry: { create: rec("timeEntry.create") },
    serviceNote: { create: rec("serviceNote.create") },
    expense: { create: rec("expense.create") },
    document: { register: rec("document.register"), createFolder: rec("document.createFolder"), tree: rec("document.tree"), suggestFromText: rec("document.suggestFromText") },
    invoice: { createRadgivning: rec("invoice.createRadgivning"), setStatus: rec("invoice.setStatus"), recordPayment: rec("invoice.recordPayment") },
    billingRun: {
      createAcconto: rec("billingRun.createAcconto"), createKostnadsrakning: rec("billingRun.createKostnadsrakning"),
      recordKostnadsrakningBeslut: rec("billingRun.recordKostnadsrakningBeslut"), settleCoverage: rec("billingRun.settleCoverage"),
      recordInsurerPruning: rec("billingRun.recordInsurerPruning"), setVerdict: rec("billingRun.setVerdict"),
      createFinal: rec("billingRun.createFinal"),
    },
  };
  return { c, calls };
}

const PARTIES = { klient: "c-k", motpart: "c-m", motpartsombud: "c-o", domstol: "c-d" };
const rhMatter = (nr: string): SimMatter => ({
  id: `m-${nr}`, matterNumber: nr, paymentMethod: "RATTSHJALP", clientShareBips: 4000,
  lawyerId: "u-1", startDaysAgo: 200, arvodeRateOre: 162_600,
});

async function beslutArgs(events: Any[], matter: SimMatter): Promise<Any> {
  const { c, calls } = recordingCaller();
  const ctx: RunCtx = { c, res: emptyRunResult() };
  await runScenario(ctx, matter, events);
  return calls.find((x) => x.method === "billingRun.recordKostnadsrakningBeslut")?.args;
}

describe("prutning i demo-scenarierna (#936)", () => {
  it("rättshjälp UTAN prutning: domstolen beviljar hela det yrkade beloppet", async () => {
    const args = await beslutArgs(buildRattshjalpScenario(PARTIES), rhMatter("2026-0002"));
    expect(args?.awardedOre).toBe(5_000_000); // = KR:ns workValueOreAtRun
  });

  it("rättshjälp MED prutning: nedsättningen räknas på nettoarbetet och skalar med satsen", async () => {
    const a15 = await beslutArgs(buildRattshjalpScenario(PARTIES, { courtPrutningBips: 1500 }), rhMatter("2026-0010"));
    const a30 = await beslutArgs(buildRattshjalpScenario(PARTIES, { courtPrutningBips: 3000 }), rhMatter("2026-0010"));
    expect(a15?.awardedOre).toBeGreaterThan(0);
    // Större nedsättning → lägre beviljat belopp, och förhållandet följer satserna
    // (85 % resp. 70 % av samma nettoarbete).
    expect(a30?.awardedOre).toBeLessThan(a15!.awardedOre);
    expect(a15!.awardedOre / a30!.awardedOre).toBeCloseTo(85 / 70, 2);
    // Beloppet härleds ur KR:ns YRKADE belopp (arvode + utlägg inkl moms) — precis
    // som en riktig domstol prutar. 85 % av stubbens 5 000 000 (#943).
    expect(a15?.awardedOre).toBe(4_250_000);
    expect(a30?.awardedOre).toBe(3_500_000);
  });

  it("2026-0010 väljs som rättshjälps-prutningsärende, 2026-0020 lämnas orört", async () => {
    const withPrutning = buildScenario(rhMatter("2026-0010"), PARTIES, 0);
    const beslut = withPrutning.find((e) => e.kind === "beslut") as Any;
    expect(beslut?.reducedByBips).toBe(1500);

    // Årsskiftes-ärendet (taxe-showcase) ska INTE prutas — annars blandas exemplen.
    const arsskifte = buildScenario({ ...rhMatter("2026-0020") }, PARTIES, 0);
    expect((arsskifte.find((e) => e.kind === "beslut") as Any)?.reducedByBips).toBeUndefined();
  });

  it("rättsskydd 2026-0021 prutas av försäkringen → klienten bär (insurerPruning)", async () => {
    const events = buildScenario(
      { id: "m-21", matterNumber: "2026-0021", paymentMethod: "RATTSSKYDD", clientShareBips: 2000, lawyerId: "u-1", startDaysAgo: 200, arvodeRateOre: 162_600 },
      PARTIES, 0,
    );
    const pruning = events.find((e) => e.kind === "insurerPruning") as Any;
    expect(pruning?.prunedNetOre).toBeGreaterThan(0);
    // Ingen dom-nedsättning i rättsskydd — bolagets prutning går via egen händelse.
    expect(events.some((e) => e.kind === "beslut")).toBe(false);
  });
});
