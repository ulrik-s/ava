/**
 * Scenario 3 — fakturering samtidigt i samma byrå (#1366): flera jurister
 * skapar aconto-fakturor och kostnadsräkningar parallellt. Numren tilldelas i
 * serverns körning (#1243, ADR 0012) — serierna ska vara obrutna och unika.
 *
 * För största möjliga samtidighet köas fakturorna offline och alla kommer
 * tillbaka på en gång: omkörningarna slåss då om byråns nummerlås.
 */

import { logTime, openMatter } from "../actions";
import { ActionTally, dbFor, rejectedCounts, rejectionsSince, type LoadContext, type ScenarioResult } from "../context";
import { checkSeries, seriesViolations, type SeriesCheck } from "../invariants";
import { rng } from "../rng";
import type { VirtualUser } from "../virtual-user";

/** Rättshjälpsärenden med en tidspost var — redo för en kostnadsräkning. */
async function krMatters(vu: VirtualUser, count: number, tally: ActionTally): Promise<string[]> {
  const r = rng(vu.index * 31);
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = await tally.run("rättshjälpsärende", () => openMatter(vu, `KR-ärende u${vu.index}.${i}`, "RATTSHJALP"));
    if (!id) continue;
    await tally.run("tid (KR)", () => logTime(vu, id, r, `kr u${vu.index}.${i}`));
    ids.push(id);
  }
  return ids;
}

/** Köa fakturorna offline: aconton på det egna ärendet + en kostnadsräkning per rättshjälpsärende. */
async function queueBilling(vu: VirtualUser, matterId: string, krIds: readonly string[], invoices: number, tally: ActionTally): Promise<void> {
  for (let i = 0; i < invoices; i++) {
    await tally.run("aconto", () => vu.api.billingRun.createAcconto.mutate({ matterId, clientShareBips: 10000, amountOre: (i + 1) * 100_000 }));
  }
  for (const id of krIds) {
    await tally.run("kostnadsräkning", () => vu.api.billingRun.createKostnadsrakning.mutate({ matterId: id }));
  }
}

export async function runInvoice(ctx: LoadContext): Promise<ScenarioResult> {
  const start = Date.now();
  const tally = new ActionTally();
  const krByUser = await Promise.all(ctx.users.map((vu) => krMatters(vu, ctx.config.krPerUser, tally)));
  await Promise.all(ctx.users.map((vu) => vu.drain(120_000).catch((e: unknown) => tally.fail("tömning (förberedelse)", e))));

  const rejectedBefore = rejectedCounts(ctx.users);
  for (const vu of ctx.users) vu.online = false;
  await Promise.all(ctx.users.map((vu, i) => queueBilling(vu, ctx.matters.get(vu.index) ?? "", krByUser[i] ?? [], ctx.config.invoicesPerUser, tally)));
  const t0 = performance.now();
  for (const vu of ctx.users) vu.online = true;
  await Promise.all(ctx.users.map((vu) => vu.drain(ctx.config.thresholds.maxDrainS * 1000).catch((e: unknown) => tally.fail("tömning", e))));
  const drainMs = Math.round(performance.now() - t0);

  const violations: string[] = [];
  const series: Record<string, { invoices: SeriesCheck[]; kr: SeriesCheck[] }> = {};
  for (const org of ctx.config.orgs) {
    const db = dbFor(ctx, org.index);
    const invoices = checkSeries(await db.invoiceNumbers());
    const kr = checkSeries(await db.krReferences());
    series[`byrå ${org.index}`] = { invoices, kr };
    violations.push(...seriesViolations(`fakturanummer byrå ${org.index}`, invoices), ...seriesViolations(`KR-referens byrå ${org.index}`, kr));
  }
  const rejected = rejectionsSince(ctx.users, rejectedBefore);
  if (rejected.count > 0) violations.push(`fakturering: ${rejected.count} anrop avvisades av servern (t.ex. ${rejected.examples[0]})`);
  if (tally.failures > 0) violations.push(`fakturering: ${tally.failures} handlingar misslyckades (se exempel)`);
  return {
    scenario: "invoice",
    durationMs: Date.now() - start,
    details: { drainMs, rejected, series, actions: tally.toJSON() },
    violations,
  };
}
