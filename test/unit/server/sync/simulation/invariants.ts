/**
 * Invarianterna efter ett simuleringsförlopp (#1268, #1358).
 *
 *   - Ingen ändring försvinner tyst: varje köpost fick ett utfall på servern,
 *     och en avvisning syns i webbläsarens avvisade ändringar.
 *   - Konvergens över ALLA synkade tabeller: varje flik har exakt de rader
 *     (och värden) som en ny klient får när den pullar byrån från cursor 0.
 *   - Byråavgränsning: ingen flik har en annan byrås rader, och en
 *     manipulerad köpost mot en annan byrå avvisas.
 *   - Roller: en administratörsprocedur avvisas med FORBIDDEN för den som
 *     inte är administratör på servern (också om webbläsaren tror det), och
 *     godtas för en administratör.
 *   - Serierna: fakturanummer, kostnadsräkningsreferenser och ärendenummer är
 *     unika och utan luckor per byrå och serie.
 *   - Varje omkört anrop har ett sparat utfall.
 *   - Serverläget är detsamma som en seriell körning av de accepterade
 *     ändringarna i den ordning servern tillämpade dem, på en ny databas.
 */
import { and, eq } from "drizzle-orm";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import { buildContext } from "@/lib/server/build-context";
import { ENTITY_NAME_BY_SOURCE_KEY } from "@/lib/server/data-store/in-memory/entity-source-keys";
import { isProcedureCall, type QueueEntry } from "@/lib/server/data-store/in-memory/mutation-queue";
import { billingRuns, invoiceNumbers, invoices, matters, syncReplays } from "@/lib/server/db/schema";
import type { AppDb } from "@/lib/server/db/types";
import { serverFirstEventLog } from "@/lib/server/http/server-context";
import { DrizzleSyncStore } from "@/lib/server/sync/drizzle-sync-store";
import { DrizzleProcedureReplayer } from "@/lib/server/sync/procedure-replayer";
import { comparable } from "@/lib/server/sync/push-guard";
import { asId } from "@/lib/shared/schemas/ids";
import { createTestDb } from "../../db/pg-test-db";
import type { SimBrowser, SimTab } from "./sim-browser";
import { ADMIN_PATHS } from "./sim-ops";
import { FIRMS, seedWorld, type Firm, type ServerOutcome, type SimServer, type SimUser } from "./sync-world";

type Row = Record<string, unknown>;
/** entitet → id → rad (bara levande rader). */
type State = Map<string, Map<string, Row>>;

/** Räkna också avvikelser som beror på kända buggar som fel (för att pröva en fix). */
const STRICT = process.env.AVA_SIM_STRICT === "1";

/** Fält som speglar när en skrivning gjordes på servern, inte vad den skrev. */
const VOLATILE: ReadonlySet<string> = new Set(["createdAt", "updatedAt", "deletedAt"]);

/** Ett jämförbart värde: datum som ISO, objekt med sorterade nycklar, saknat = null. */
function norm(v: unknown): unknown {
  const c = comparable(v);
  if (Array.isArray(c)) return c.map(norm);
  if (c !== null && typeof c === "object") {
    return Object.fromEntries(Object.keys(c).sort().map((k) => [k, norm((c as Row)[k])]));
  }
  return c;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

/** Byråns läge så som en ny klient ser det: en pull från cursor 0. */
export async function canonicalState(sync: DrizzleSyncStore, org: string): Promise<State> {
  const state: State = new Map();
  for (const ch of (await sync.pull(org, 0)).changes) {
    if (ch.deleted) continue;
    const rows = state.get(ch.entity) ?? new Map<string, Row>();
    rows.set(String(ch.row.id), ch.row);
    state.set(ch.entity, rows);
  }
  return state;
}

/** Fliken lokala läge, per entitet. */
function localState(t: SimTab): State {
  const state: State = new Map();
  for (const [key, entity] of Object.entries(ENTITY_NAME_BY_SOURCE_KEY)) {
    state.set(entity, new Map(t.rows(key).map((row) => [String(row.id), row])));
  }
  return state;
}

/** Skillnaden mellan två rader, på serverradens fält (utom `skip`). */
function rowDiff(expected: Row, actual: Row, skip: ReadonlySet<string>): string[] {
  return Object.keys(expected).filter((k) => !skip.has(k) && !same(expected[k], actual[k]));
}

/** En avvikelse: vilken rad, och hur. */
interface Divergence { entity: string; id: string; what: string }

function diffStates(expected: State, actual: State, skip: ReadonlySet<string>): Divergence[] {
  const out: Divergence[] = [];
  for (const entity of new Set([...expected.keys(), ...actual.keys()])) {
    const exp = expected.get(entity) ?? new Map<string, Row>();
    const act = actual.get(entity) ?? new Map<string, Row>();
    for (const [id, row] of exp) {
      const local = act.get(id);
      if (!local) { out.push({ entity, id, what: "saknas" }); continue; }
      const fields = rowDiff(row, local, skip);
      if (fields.length > 0) out.push({ entity, id, what: `skiljer sig i ${fields.join(", ")}` });
    }
    for (const id of act.keys()) if (!exp.has(id)) out.push({ entity, id, what: "finns bara här" });
  }
  return out;
}

/** Raderna en köpost ändrade. */
function keysOf(entry: QueueEntry): string[] {
  return isProcedureCall(entry) ? entry.touches.map((t) => `${t.entity}:${t.id}`) : [`${entry.entity}:${String(entry.row.id)}`];
}

/** Rader som en avvisad ändring rörde, i webbläsarens avvisade ändringar. */
async function refusedRows(b: SimBrowser): Promise<Set<string>> {
  return new Set((await b.rejected()).flatMap((change) => keysOf(change.entry)));
}

/** Resultatet av invarianterna: fel, och fel som beror på en känd, öppen bugg. */
export interface Verdict {
  violations: string[];
  /** Avvikelser som beror på en känd, öppen bugg — märkta med ärendet. */
  known: string[];
}

/**
 * Kända, öppna buggar som en avvikelse kan bero på. Ta bort raden när buggen
 * är fixad (`AVA_SIM_STRICT=1` räknar dem som fel redan nu):
 *   - #1397: en radering av en rad som redan är raderad på servern lämnar en
 *     stomrad (bara `id`, ingen `version`) lokalt.
 *   - #1402: med flera flikar lämnar en avvisad ändring spökrader i fliken
 *     som gjorde den, när en annan flik skickade den (#1392 återställer bara
 *     i den fliken). Gäller bara webbläsare med flera flikar — i en ensam
 *     flik är samma avvikelse ett fel (#1348).
 *   - #1399: en radändring av en rad som servern har raderat ger ett
 *     serverfel (dubblettnyckel) och kön står still i minuter — allt i den
 *     webbläsarens kö och dess flikars läge räknas då som känt.
 */
function knownBug(d: Divergence, local: Row | undefined, refusedInSharedQueue: ReadonlySet<string>): string | null {
  if (STRICT) return null;
  if (refusedInSharedQueue.has(`${d.entity}:${d.id}`)) return "#1402";
  if (local && local.version === undefined) return "#1397";
  return null;
}

/** Byråernas läge så som en ny klient ser det (org → läge). */
type States = Map<string, State>;

/** #1399: står webbläsarens kö still vid en radändring av en rad som servern har raderat? */
async function blockedByDeletedRow(b: SimBrowser, states: States): Promise<boolean> {
  const [head] = await b.storedQueue();
  if (STRICT || !head || isProcedureCall(head) || head.kind !== "update") return false;
  return !states.get(b.firm.org)?.get(head.entity)?.has(String(head.row.id));
}

/** Ingen ändring försvinner tyst. */
function silentLoss(server: SimServer, b: SimBrowser, left: number, rejected: ReadonlySet<string>): string[] {
  const out = left > 0 ? [`${b.name}: ${left} ändringar kvar i kön efter slutsynken`] : [];
  for (const [id, entry] of b.seen) {
    const outcome = server.outcomes.get(id);
    const what = isProcedureCall(entry) ? entry.path : `${entry.entity}/${entry.kind}`;
    if (!outcome) {
      // Klienten kan själv avvisa en post (#1353) — då ska den synas.
      if (!rejected.has(id)) out.push(`${b.name}: ${what} (${id}) nådde aldrig servern`);
      continue;
    }
    const refused = outcome.status === "rejected" || outcome.status === "conflict";
    if (refused && !rejected.has(id)) out.push(`${b.name}: ${what} avvisades men syns inte i avvisade ändringar`);
  }
  return out;
}

async function checkNoSilentLoss(server: SimServer, browsers: readonly SimBrowser[], blocked: ReadonlySet<string>): Promise<Verdict> {
  const verdict: Verdict = { violations: [], known: [] };
  for (const b of browsers) {
    const lines = silentLoss(server, b, (await b.storedQueue()).length, await b.rejectedIds());
    if (blocked.has(b.name)) verdict.known.push(...lines.map((l) => `#1399 ${l}`));
    else verdict.violations.push(...lines);
  }
  return verdict;
}

/** Varje flik har byråns läge, i alla synkade tabeller. */
async function checkConvergence(states: States, tabs: readonly SimTab[], blocked: ReadonlySet<string>): Promise<Verdict> {
  const verdict: Verdict = { violations: [], known: [] };
  for (const t of tabs) {
    const shared = tabs.filter((other) => other.browser === t.browser).length > 1;
    const refused = shared ? await refusedRows(t.browser) : new Set<string>();
    const expected = states.get(t.firm.org) ?? new Map();
    const local = localState(t);
    for (const d of diffStates(expected, local, new Set())) {
      const line = `${t.name}: ${d.entity} ${d.id} ${d.what}`;
      const bug = blocked.has(t.browser.name) ? "#1399" : knownBug(d, local.get(d.entity)?.get(d.id), refused);
      if (bug) verdict.known.push(`${bug} ${line}`);
      else verdict.violations.push(line);
    }
  }
  return verdict;
}

/** Ingen flik har en annan byrås rader. */
function checkIsolation(states: States, tabs: readonly SimTab[]): string[] {
  const owner = new Map<string, string>();
  for (const [org, state] of states) {
    for (const rows of state.values()) for (const id of rows.keys()) owner.set(id, org);
  }
  const out: string[] = [];
  for (const t of tabs) {
    for (const [entity, rows] of localState(t)) {
      for (const id of rows.keys()) {
        const org = owner.get(id);
        if (org && org !== t.firm.org) out.push(`${t.name}: har ${entity} ${id} från en annan byrå`);
      }
    }
  }
  return out;
}

function serverUser(userId: string): SimUser | undefined {
  return FIRMS.flatMap((f) => f.users).find((u) => u.id === userId);
}

/** Administratörsprocedurer: FORBIDDEN för andra än administratörer, godtagna för dem. */
function checkRoles(server: SimServer): string[] {
  const out: string[] = [];
  for (const o of server.log) {
    if (o.kind !== "procedure" || !ADMIN_PATHS.has(o.call.path)) continue;
    const isAdmin = serverUser(o.userId)?.role === "ADMIN";
    if (isAdmin && o.status !== "accepted") out.push(`${o.call.path} från administratören avvisades (${o.code ?? ""})`);
    if (!isAdmin && !(o.status === "rejected" && o.code === "FORBIDDEN")) out.push(`${o.call.path} från ${o.userId} gav ${o.status}/${o.code ?? ""}, inte FORBIDDEN`);
  }
  return out;
}

/** En manipulerad köpost mot en annan byrå avvisas. */
function checkForged(server: SimServer, forged: ReadonlySet<string>): string[] {
  return [...forged].flatMap((id) => {
    const o = server.outcomes.get(id);
    return o && (o.status === "accepted" || o.status === "rebased") ? [`manipulerad köpost ${id} godtogs (${o.kind})`] : [];
  });
}

/** Löpnumren i en serie: 1..n, var och ett en gång. */
function gaps(series: string, seqs: readonly number[]): string[] {
  const sorted = [...seqs].sort((a, b) => a - b);
  return sorted.every((s, i) => s === i + 1) ? [] : [`${series}: löpnumren är inte 1..${sorted.length} utan luckor och dubbletter: ${sorted.join(", ")}`];
}

/** Gruppera nummer per serie (prefix) med löpnumret. */
function bySeries(numbers: readonly string[], re: RegExp): Map<string, number[]> {
  const series = new Map<string, number[]>();
  for (const n of numbers) {
    const m = re.exec(n);
    if (!m) continue;
    const key = m[1] ?? "";
    series.set(key, [...(series.get(key) ?? []), Number(m[2])]);
  }
  return series;
}

const INVOICE_RE = /^(F-\d{4}-)(\d{4})$/;
const KR_RE = /^(KR-\d{4}-)(\d{4})$/;
const MATTER_RE = /^([A-ZÅÄÖ]{0,3}\d{4}-)(\d{4})$/;

/** Fakturanummer, KR-referenser och ärendenummer: unika och utan luckor per byrå och serie. */
async function checkSeries(db: AppDb, firm: Firm): Promise<string[]> {
  const org = asId<"OrganizationId">(firm.org);
  const register = await db.select({ n: invoiceNumbers.invoiceNumber, invoiceId: invoiceNumbers.invoiceId }).from(invoiceNumbers).where(eq(invoiceNumbers.organizationId, org));
  const numbered = await db.select({ id: invoices.id, n: invoices.invoiceNumber }).from(invoices)
    .innerJoin(matters, eq(invoices.matterId, matters.id)).where(eq(matters.organizationId, org));
  const runs = await db.select({ ref: billingRuns.reference }).from(billingRuns).innerJoin(matters, eq(billingRuns.matterId, matters.id)).where(eq(matters.organizationId, org));
  const matterNumbers = await db.select({ n: matters.matterNumber }).from(matters).where(eq(matters.organizationId, org));
  const registered = new Map(register.map((r) => [r.n, String(r.invoiceId)]));
  const unregistered = numbered.filter((i) => i.n && registered.get(i.n) !== String(i.id)).map((i) => `byrå ${firm.key}: faktura ${i.id} har ${i.n ?? ""} som inte är registrerat på den`);
  const series = [
    ...bySeries(register.map((r) => r.n), INVOICE_RE),
    ...bySeries(runs.flatMap((r) => (r.ref ? [r.ref] : [])), KR_RE),
    ...bySeries(matterNumbers.map((m) => m.n), MATTER_RE),
  ];
  return [...unregistered, ...series.flatMap(([prefix, seqs]) => gaps(`byrå ${firm.key} ${prefix}`, seqs))];
}

/** Principalen servern använde för ett anrop (serverns roll, inte webbläsarens). */
function principalFor(o: Extract<ServerOutcome, { kind: "procedure" }>): Parameters<typeof buildContext>[0]["principal"] {
  const u = serverUser(o.userId);
  return {
    id: asId<"UserId">(o.userId), email: u?.email ?? "", name: u?.name ?? "", role: u?.role ?? "LAWYER", organizationId: asId<"OrganizationId">(o.org),
  };
}

/** Slutligt serverläge = seriell körning av de accepterade ändringarna, i serverns ordning. */
async function checkSerial(server: SimServer): Promise<string[]> {
  const fresh = await createTestDb();
  try {
    const repos = await seedWorld(fresh);
    const replayer = new DrizzleProcedureReplayer(fresh.db, repos);
    const sync = new DrizzleSyncStore(fresh.db, repos);
    for (const o of server.applied) {
      if (o.kind === "row") { await sync.push(o.pusher, o.mutation); continue; }
      await replayer.replay(o.call, buildContext({ repos, eventLog: serverFirstEventLog, ports: noopPorts, principal: principalFor(o) }));
    }
    const out: string[] = [];
    for (const firm of FIRMS) {
      const diffs = diffStates(await canonicalState(sync, firm.org), await canonicalState(server.sync, firm.org), VOLATILE);
      out.push(...diffs.map((d) => `seriell körning, byrå ${firm.key}: ${d.entity} ${d.id} ${d.what}`));
    }
    return out;
  } finally {
    await fresh.close();
  }
}

/** Varje omkört anrop har ett sparat utfall i sync_replays (per byrå). */
async function checkStoredReplays(server: SimServer): Promise<string[]> {
  const out: string[] = [];
  for (const o of server.outcomes.values()) {
    if (o.kind !== "procedure") continue;
    const [row] = await server.handle.db.select({ id: syncReplays.mutationId }).from(syncReplays)
      .where(and(eq(syncReplays.mutationId, o.call.mutationId), eq(syncReplays.organizationId, asId<"OrganizationId">(o.org)))).limit(1);
    if (!row) out.push(`${o.call.path} (${o.call.mutationId}) saknar sparat utfall`);
  }
  return out;
}

export async function checkInvariants(server: SimServer, browsers: readonly SimBrowser[], tabs: readonly SimTab[], forged: ReadonlySet<string>): Promise<Verdict> {
  const states: States = new Map();
  for (const firm of FIRMS) states.set(firm.org, await canonicalState(server.sync, firm.org));
  const blocked = new Set<string>();
  for (const b of browsers) if (await blockedByDeletedRow(b, states)) blocked.add(b.name);
  const loss = await checkNoSilentLoss(server, browsers, blocked);
  const convergence = await checkConvergence(states, tabs, blocked);
  const series = await Promise.all(FIRMS.map((f) => checkSeries(server.handle.db, f)));
  return {
    violations: [
      ...loss.violations,
      ...convergence.violations,
      ...checkIsolation(states, tabs),
      ...checkRoles(server),
      ...checkForged(server, forged),
      ...series.flat(),
      ...(await checkStoredReplays(server)),
      ...(await checkSerial(server)),
    ],
    known: [...loss.known, ...convergence.known],
  };
}
