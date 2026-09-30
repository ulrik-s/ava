/**
 * Ett seedat simuleringsförlopp (#1268): slumpade ändringar, avbrott,
 * omstarter och omordning — och sedan invarianterna.
 *
 * Samma seed ger samma förlopp (vilka klienter, vilka operationer, när nätet
 * går ned). Id:n och tidsstämplar är riktiga, men påverkar inte förloppet.
 */
import { and, eq, isNull } from "drizzle-orm";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import { buildContext } from "@/lib/server/build-context";
import { contacts, invoices, syncReplays, timeEntries } from "@/lib/server/db/schema";
import type { AppDb } from "@/lib/server/db/types";
import { serverFirstEventLog } from "@/lib/server/http/server-context";
import { DrizzleSyncStore } from "@/lib/server/sync/drizzle-sync-store";
import { DrizzleProcedureReplayer } from "@/lib/server/sync/procedure-replayer";
import { asId } from "@/lib/shared/schemas/ids";
import { createTestDb } from "../../db/pg-test-db";
import { isProcedure, MATTER, ORG, seedWorld, SimClient, SimServer, userFor } from "./sync-world";

/** Deterministisk slump (mulberry32). */
export function rng(seed: number): { next: () => number; int: (lo: number, hi: number) => number; pick: <T>(xs: readonly T[]) => T | undefined } {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number): number => lo + Math.floor(next() * (hi - lo + 1));
  return { next, int, pick: (xs) => xs[Math.floor(next() * xs.length)] };
}

type Rng = ReturnType<typeof rng>;
type Op = (c: SimClient, r: Rng, step: number) => Promise<unknown>;

const DAY = "2026-09-15";

const ids = (rows: Array<Record<string, unknown>>): string[] => rows.map((row) => String(row.id));

/** Operationerna och deras vikter. En lokal regel som säger nej är ett giltigt utfall. */
const OPS: ReadonlyArray<[number, string, Op]> = [
  [6, "tidspost", (c, r, n) => c.api.timeEntry.create.mutate({ matterId: MATTER, date: DAY, minutes: r.int(1, 12) * 15, description: `Post ${c.index}.${n}` })],
  [6, "ändra tidspost", (c, r) => {
    const id = r.pick(ids(c.rows("timeEntries")));
    return id ? c.api.timeEntry.update.mutate({ id, minutes: r.int(1, 12) * 15 }) : Promise.resolve();
  }],
  [3, "ta bort tidspost", (c, r) => {
    const id = r.pick(ids(c.rows("timeEntries")));
    return id ? c.api.timeEntry.delete.mutate({ id }) : Promise.resolve();
  }],
  [3, "kontakt", (c, _r, n) => c.api.contacts.create.mutate({ name: `Kontakt ${c.index}.${n}`, contactType: "PERSON" })],
  [2, "byt namn på kontakt", (c, r, n) => {
    const id = r.pick(ids(c.rows("contacts")));
    return id ? c.api.contacts.update.mutate({ id, name: `Omdöpt ${c.index}.${n}` }) : Promise.resolve();
  }],
  [2, "acontofaktura", (c, r) => c.api.billingRun.createAcconto.mutate({ matterId: MATTER, clientShareBips: 10000, amountOre: r.int(1, 20) * 10_000 })],
  [4, "nät av/på", async (c) => { c.online = !c.online; }],
  [4, "synka", (c) => c.sync()],
  [1, "avbrott mitt i synken", async (c, r) => { c.online = true; c.dropAfter = r.int(0, 3); await c.sync(); }],
  [1, "omstart", (c) => c.boot()],
];

function chooseOp(r: Rng): [string, Op] {
  const total = OPS.reduce((sum, [w]) => sum + w, 0);
  let x = r.next() * total;
  for (const [w, name, op] of OPS) {
    if ((x -= w) < 0) return [name, op];
  }
  const last = OPS[OPS.length - 1]!;
  return [last[1], last[2]];
}

/** Resultatet av en körning: fel per invariant (tomt = allt höll). */
export interface SimulationResult {
  seed: number;
  steps: string[];
  violations: string[];
}

export async function simulate(seed: number, opts: { clients: number; steps: number }): Promise<SimulationResult> {
  const r = rng(seed);
  const server = await SimServer.start(opts.clients);
  const clients = Array.from({ length: opts.clients }, (_, i) => new SimClient(i, server));
  const steps: string[] = [];
  try {
    for (const c of clients) { await c.boot(); await c.sync(); }
    for (let n = 0; n < opts.steps; n++) {
      const c = clients[r.int(0, clients.length - 1)]!;
      const [name, op] = chooseOp(r);
      steps.push(`${c.index}:${name}`);
      await op(c, r, n).catch((e: unknown) => { if (process.env.AVA_SIM_DEBUG) console.log("OPFEL", name, e instanceof Error ? e.message.slice(0, 200) : e); });
      c.observeQueue();
    }
    // Alla online; synka runt tills köerna är tomma och alla sett allas ändringar.
    for (const c of clients) { c.online = true; c.dropAfter = null; }
    for (let round = 0; round < 3; round++) for (const c of clients) await c.sync();
    const outcomeCounts: Record<string, number> = {};
    for (const o of server.outcomes.values()) outcomeCounts[`${o.kind}:${o.status}`] = (outcomeCounts[`${o.kind}:${o.status}`] ?? 0) + 1;
    const stats = { outcomes: outcomeCounts, applied: server.applied.length, rejected: clients.map((c) => c.rejected.list().length), seen: clients.map((c) => c.seen.size), entries: clients.map((c) => c.rows("timeEntries").length), invoices: clients.map((c) => c.rows("invoices").length) };
    return { seed, steps, violations: await checkInvariants(server, clients), stats } as SimulationResult;
  } finally {
    await server.handle.close();
  }
}

type Key = Record<string, unknown>;

async function serverState(db: AppDb): Promise<{ entries: Key[]; contactRows: Key[]; invoiceRows: Key[] }> {
  const entries = await db.select({ id: timeEntries.id, minutes: timeEntries.minutes, description: timeEntries.description })
    .from(timeEntries).where(and(eq(timeEntries.matterId, MATTER), isNull(timeEntries.deletedAt)));
  const contactRows = await db.select({ id: contacts.id, name: contacts.name }).from(contacts)
    .where(and(eq(contacts.organizationId, ORG), isNull(contacts.deletedAt)));
  const invoiceRows = await db.select({ id: invoices.id, amount: invoices.amount, invoiceNumber: invoices.invoiceNumber })
    .from(invoices).where(and(eq(invoices.matterId, MATTER), isNull(invoices.deletedAt)));
  const byId = (a: Key, b: Key): number => String(a.id).localeCompare(String(b.id));
  return { entries: entries.sort(byId), contactRows: contactRows.sort(byId), invoiceRows: invoiceRows.sort(byId) };
}

function project(rows: Array<Record<string, unknown>>, fields: readonly string[]): Key[] {
  return rows.map((row) => Object.fromEntries(fields.map((f) => [f, row[f] ?? null])))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Ingen ändring försvinner tyst: varje köpost fick ett utfall, och en avvisning syns hos klienten. */
function checkNoSilentLoss(server: SimServer, clients: readonly SimClient[]): string[] {
  const out: string[] = [];
  for (const c of clients) {
    if (c.store.pendingCount() > 0) out.push(`klient ${c.index}: ${c.store.pendingCount()} ändringar kvar i kön efter slutsynken`);
    const rejectedIds = new Set(c.rejected.list().map((x) => x.id));
    for (const [id, entry] of c.seen) {
      const outcome = server.outcomes.get(id);
      const what = isProcedure(entry) ? entry.path : `${entry.entity}/${entry.kind}`;
      if (!outcome) { out.push(`klient ${c.index}: ${what} (${id}) nådde aldrig servern`); continue; }
      const refused = outcome.status === "rejected" || outcome.status === "conflict";
      if (refused && !rejectedIds.has(id)) out.push(`klient ${c.index}: ${what} avvisades men syns inte i avvisade ändringar`);
    }
  }
  return out;
}

/** Klienterna konvergerar mot serverns läge. */
function checkConvergence(state: Awaited<ReturnType<typeof serverState>>, clients: readonly SimClient[]): string[] {
  const out: string[] = [];
  for (const c of clients) {
    const local = {
      entries: project(c.rows("timeEntries").filter((e) => e.matterId === MATTER), ["id", "minutes", "description"]),
      contactRows: project(c.rows("contacts"), ["id", "name"]),
      invoiceRows: project(c.rows("invoices").filter((i) => i.matterId === MATTER), ["id", "amount", "invoiceNumber"]),
    };
    for (const k of ["entries", "contactRows", "invoiceRows"] as const) {
      if (!same(local[k], state[k])) out.push(`klient ${c.index}: ${k} skiljer sig från servern`);
    }
  }
  return out;
}

/** Inga dubbla fakturanummer. */
function checkInvoiceNumbers(state: Awaited<ReturnType<typeof serverState>>): string[] {
  const numbers = state.invoiceRows.map((i) => i.invoiceNumber).filter((n) => n != null);
  return new Set(numbers).size === numbers.length ? [] : [`dubbla fakturanummer: ${numbers.join(", ")}`];
}

/** Slutligt serverläge = seriell körning av de accepterade ändringarna, i serverns ordning. */
async function checkSerial(server: SimServer, clients: number): Promise<string[]> {
  const fresh = await createTestDb();
  try {
    const repos = await seedWorld(fresh, clients);
    const replayer = new DrizzleProcedureReplayer(fresh.db, repos);
    const sync = new DrizzleSyncStore(fresh.db, repos);
    for (const o of server.applied) {
      if (o.kind === "row") { await sync.push(ORG, o.mutation); continue; }
      const u = Array.from({ length: clients }, (_, i) => userFor(i)).find((x) => x.id === o.userId);
      const ctx = buildContext({
        repos, eventLog: serverFirstEventLog, ports: noopPorts,
        principal: { id: asId<"UserId">(o.userId), email: u?.email ?? "", name: u?.name ?? "", role: "LAWYER", organizationId: asId<"OrganizationId">(ORG) },
      });
      await replayer.replay(o.call, ctx);
    }
    const serial = await serverState(fresh.db);
    const actual = await serverState(server.handle.db);
    return same(serial, actual) ? [] : ["serverläget skiljer sig från en seriell körning av de accepterade ändringarna"];
  } finally {
    await fresh.close();
  }
}

async function checkInvariants(server: SimServer, clients: readonly SimClient[]): Promise<string[]> {
  const state = await serverState(server.handle.db);
  const replays = await server.handle.db.select({ id: syncReplays.mutationId }).from(syncReplays);
  const stored = new Set(replays.map((x) => x.id));
  const unstored = [...server.outcomes.values()].filter((o) => o.kind === "procedure" && !stored.has(o.call.mutationId));
  return [
    ...checkNoSilentLoss(server, clients),
    ...checkConvergence(state, clients),
    ...checkInvoiceNumbers(state),
    ...(unstored.length > 0 ? [`${unstored.length} omkörda anrop saknar sparat utfall`] : []),
    ...(await checkSerial(server, clients.length)),
  ];
}
