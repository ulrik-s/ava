/**
 * Scenario 2 — anslutningsstorm (#1366): alla går offline, köar 50–200
 * ändringar var och kommer tillbaka SAMTIDIGT — alla köer spelas upp på en gång.
 *
 * Krav: alla köer tomma inom gränsen (2 min vid 20, 5 min vid 50), ingen
 * mutation förlorad eller dubblerad, inga avvisningar.
 */

import { addContact, addExpense, addNote, editTime, logTime } from "../actions";
import { ActionTally, dbFor, rejectedCounts, rejectionsSince, type LoadContext, type ScenarioResult } from "../context";
import { checkDelivery, type DeliveryCheck } from "../invariants";
import { rng, weighted, type Rng } from "../rng";
import { summarize } from "../stats";
import type { VirtualUser } from "../virtual-user";

type Table = "time_entries" | "expenses" | "contacts" | "service_notes";

/** Vad en användare köade offline: skapade id:n per tabell. */
type Created = Record<Table, string[]>;

type OfflineAction = (vu: VirtualUser, matterId: string, r: Rng, n: number, created: Created) => Promise<void>;

const OFFLINE_ACTIONS: ReadonlyArray<readonly [number, readonly [string, OfflineAction]]> = [
  [50, ["tid", async (vu, m, r, n, c) => { c.time_entries.push(await logTime(vu, m, r, `storm u${vu.index}.${n}`)); }]],
  [15, ["ändra tid", async (vu, m, r, n, c) => {
    const id = r.pick(c.time_entries);
    if (id) await editTime(vu, id, r);
    else c.time_entries.push(await logTime(vu, m, r, `storm u${vu.index}.${n}`));
  }]],
  [15, ["utlägg", async (vu, m, r, n, c) => { c.expenses.push(await addExpense(vu, m, r, `storm u${vu.index}.${n}`)); }]],
  [10, ["kontakt", async (vu, _m, _r, n, c) => { c.contacts.push(await addContact(vu, `storm u${vu.index}.${n}`)); }]],
  [10, ["anteckning", async (vu, m, _r, n, c) => { c.service_notes.push(await addNote(vu, m, `storm u${vu.index}.${n}`)); }]],
];

/** Köa `count` ändringar offline. */
async function queueOffline(vu: VirtualUser, matterId: string, count: number, seed: number, tally: ActionTally): Promise<Created> {
  const r = rng(seed);
  const created: Created = { time_entries: [], expenses: [], contacts: [], service_notes: [] };
  for (let n = 0; n < count; n++) {
    const picked = weighted(r, OFFLINE_ACTIONS);
    if (picked) await tally.run(picked[0], () => picked[1](vu, matterId, r, n, created));
  }
  return created;
}

/** Leverans per tabell, summerat över byråns användare. */
async function deliveryFor(ctx: LoadContext, orgIndex: number, created: readonly Created[]): Promise<Record<string, DeliveryCheck>> {
  const db = dbFor(ctx, orgIndex);
  const tables: Table[] = ["time_entries", "expenses", "contacts", "service_notes"];
  const checks = await Promise.all(tables.map(async (t) => {
    const expected = created.flatMap((c) => c[t]);
    return [t, checkDelivery(expected, await db.existing(t, expected))] as const;
  }));
  return Object.fromEntries(checks);
}

function deliveryViolations(orgIndex: number, delivery: Record<string, DeliveryCheck>): string[] {
  return Object.entries(delivery).flatMap(([t, d]) => [
    ...(d.missing.length > 0 ? [`storm byrå ${orgIndex}: ${d.missing.length} av ${d.expected} ${t} förlorade (t.ex. ${d.missing[0]})`] : []),
    ...(Object.keys(d.duplicated).length > 0 ? [`storm byrå ${orgIndex}: ${Object.keys(d.duplicated).length} ${t} dubblerade`] : []),
  ]);
}

export async function runStorm(ctx: LoadContext): Promise<ScenarioResult> {
  const start = Date.now();
  const tally = new ActionTally();
  const limitMs = ctx.config.thresholds.maxDrainS * 1000;
  const rejectedBefore = rejectedCounts(ctx.users);
  for (const vu of ctx.users) vu.online = false;
  const sizes = ctx.users.map((vu) => rng(ctx.config.seed * 7 + vu.index).int(ctx.config.offlineMin, ctx.config.offlineMax));
  const created = await Promise.all(ctx.users.map((vu, i) => queueOffline(vu, ctx.matters.get(vu.index) ?? "", sizes[i] ?? 0, ctx.config.seed * 13 + vu.index, tally)));
  const queued = ctx.users.map((vu) => vu.store.pendingCount());

  // Alla tillbaka på en gång.
  const t0 = performance.now();
  for (const vu of ctx.users) vu.online = true;
  const drains = await Promise.all(ctx.users.map((vu) => vu.drain(limitMs + 60_000).then((ms) => ms, (e: unknown) => { tally.fail("tömning", e); return Number.NaN; })));
  const drainMs = Math.round(performance.now() - t0);

  const violations: string[] = [];
  if (drains.some((ms) => Number.isNaN(ms))) violations.push(`storm: minst en kö tömdes inte (se exempel)`);
  if (drainMs > limitMs) violations.push(`storm: köerna tömdes på ${(drainMs / 1000).toFixed(1)} s (gräns ${ctx.config.thresholds.maxDrainS} s)`);
  const delivery: Record<string, Record<string, DeliveryCheck>> = {};
  for (const org of ctx.config.orgs) {
    const inOrg = ctx.users.map((vu, i) => ({ vu, c: created[i] })).filter((x) => x.vu.user.org.index === org.index).flatMap((x) => (x.c ? [x.c] : []));
    const d = await deliveryFor(ctx, org.index, inOrg);
    delivery[`byrå ${org.index}`] = d;
    violations.push(...deliveryViolations(org.index, d));
  }
  const rejected = rejectionsSince(ctx.users, rejectedBefore);
  if (rejected.count > 0) violations.push(`storm: ${rejected.count} ändringar avvisades av servern (t.ex. ${rejected.examples[0]})`);
  if (tally.failures > 0) violations.push(`storm: ${tally.failures} handlingar misslyckades (se exempel)`);

  return {
    scenario: "storm",
    durationMs: Date.now() - start,
    details: {
      users: ctx.users.length,
      queuedTotal: queued.reduce((a, b) => a + b, 0),
      queuedPerUser: summarize(queued),
      drainMs,
      drainPerUserMs: summarize(drains.filter((ms) => !Number.isNaN(ms))),
      rejected,
      delivery,
      actions: tally.toJSON(),
    },
    violations,
  };
}
