/**
 * Ett seedat simuleringsförlopp (#1268, #1358): flera byråer, roller,
 * webbläsare med flera flikar, samtidiga steg, avbrott, tappade svar,
 * omstarter och manipulerade köposter — och sedan invarianterna.
 *
 * Samma seed ger samma förlopp: vilka flikar som finns, vilka steg som körs
 * samtidigt, vilka operationer, när nätet går ned och i vilken ordning
 * anropen når servern (`SimNetwork`). Id:n och tidsstämplar är riktiga, men
 * påverkar inte förloppet.
 */
import type { UserRole } from "@/lib/shared/schemas/enums";
import { type Rng, rng } from "../../../helpers/seeded-rng";
import { checkInvariants } from "./invariants";
import { SimBrowser, SimTab } from "./sim-browser";
import { SimNetwork } from "./sim-network";
import { chooseOp, type StepContext } from "./sim-ops";
import { FIRM_A, FIRM_B, SimServer, type Firm, type ServerOutcome, type SimUser } from "./sync-world";

/** En webbläsare i förloppet: vems, vilken roll den har cachad och hur många flikar. */
interface BrowserSpec {
  readonly user: SimUser;
  readonly cachedRole: UserRole;
  readonly tabs: number;
}

/** Hur stort förloppet är. */
export interface SimOptions {
  readonly steps: number;
  /** Högst så många steg körs samtidigt (på olika flikar). */
  readonly concurrency: number;
  /** Fler webbläsare och flikar (nattlig körning). */
  readonly heavy?: boolean;
}

/** Användare `index` i byrån (världen är fast — saknas den är världen fel). */
function userOf(firm: Firm, index: number): SimUser {
  const u = firm.users[index];
  if (!u) throw new Error(`byrå ${firm.key} saknar användare ${index}`);
  return u;
}

/** Webbläsarna: A:s administratör, jurist (två flikar) och assistent; B:s degraderade jurist (+ assistent). */
function browserSpecs(heavy: boolean): BrowserSpec[] {
  const specs: BrowserSpec[] = [
    { user: userOf(FIRM_A, 0), cachedRole: "ADMIN", tabs: 1 },
    { user: userOf(FIRM_A, 1), cachedRole: "LAWYER", tabs: heavy ? 3 : 2 },
    { user: userOf(FIRM_A, 2), cachedRole: "ASSISTANT", tabs: 1 },
    // Degraderad medan den var offline: webbläsaren tror fortfarande att den är administratör.
    { user: userOf(FIRM_B, 0), cachedRole: "ADMIN", tabs: 1 },
  ];
  return heavy ? [...specs, { user: userOf(FIRM_B, 1), cachedRole: "ASSISTANT", tabs: 1 }] : specs;
}

/** Resultatet av en körning: fel per invariant (tomt = allt höll). */
export interface SimulationResult {
  seed: number;
  steps: string[];
  violations: string[];
  /** Avvikelser som beror på en känd, öppen bugg (#1397, #1399, #1402). */
  known: string[];
  stats: Record<string, unknown>;
}

/** `k` olika flikar, valda med seeden. */
function pickTabs(r: Rng, tabs: readonly SimTab[], k: number): SimTab[] {
  const pool = [...tabs];
  const out: SimTab[] = [];
  while (out.length < k && pool.length > 0) out.push(...pool.splice(r.int(0, pool.length - 1), 1));
  return out;
}

const debug = (name: string, e: unknown): void => {
  if (process.env.AVA_SIM_DEBUG) console.log("STEGFEL", name, e instanceof Error ? e.message.slice(0, 200) : e);
};

/** En rad i serverns logg (felsökning med `AVA_SIM_DEBUG`). */
function describeOutcome(o: ServerOutcome): string {
  const who = o.kind === "row" ? o.pusher.userId : o.userId;
  const what = o.kind === "row" ? `${o.mutation.entity}/${o.mutation.kind} ${String(o.mutation.row.id)}` : `${o.call.path} ${JSON.stringify(o.call.input)}`;
  const why = o.kind === "row" ? o.reason ?? "" : o.code ?? "";
  return `${o.kind === "row" ? o.mutation.mutationId : o.call.mutationId} ${who.slice(-3)} ${what.slice(0, 160)} → ${o.status} ${why}`;
}

/** Alla online; synka runt tills köerna är tomma och alla sett allas ändringar. */
async function settleAll(net: SimNetwork, tabs: readonly SimTab[]): Promise<void> {
  for (const t of tabs) { t.online = true; t.dropAfter = null; t.loseNextResponse = false; }
  for (let round = 0; round < 3; round++) {
    for (const t of tabs) await net.wave([{ actor: t.name, run: () => t.sync() }]);
  }
}

export async function simulate(seed: number, opts: SimOptions): Promise<SimulationResult> {
  const r = rng(seed);
  const net = new SimNetwork(r);
  const server = await SimServer.start();
  const browsers = browserSpecs(opts.heavy ?? false).map((s, i) => new SimBrowser(`w${i}`, s.user, s.cachedRole, r.next() < 0.75));
  const tabs = browserSpecs(opts.heavy ?? false).flatMap((s, i) => {
    const browser = browsers[i];
    return browser ? Array.from({ length: s.tabs }, (_, j) => new SimTab(`${browser.name}.${j}`, browser, server, net)) : [];
  });
  for (const b of browsers) net.watch(b.lock);
  const steps: string[] = [];
  const forged = new Set<string>();
  try {
    for (const t of tabs) await t.boot();
    await settleAll(net, tabs);
    for (let n = 0; n < opts.steps; n++) {
      const ctx: StepContext = { r, n, forged };
      const wave = pickTabs(r, tabs, r.int(1, opts.concurrency)).map((t) => {
        const [name, op] = chooseOp(r);
        steps.push(`${n} ${t.name}:${name}`);
        return { actor: t.name, run: () => op(t, ctx).catch((e: unknown) => debug(name, e)) };
      });
      await net.wave(wave);
    }
    await settleAll(net, tabs);
    const verdict = await checkInvariants(server, browsers, tabs, forged);
    if (process.env.AVA_SIM_DEBUG) for (const o of server.log) console.log("UTFALL", describeOutcome(o));
    const outcomes: Record<string, number> = {};
    for (const o of server.outcomes.values()) outcomes[`${o.kind}:${o.status}`] = (outcomes[`${o.kind}:${o.status}`] ?? 0) + 1;
    return { seed, steps, ...verdict, stats: { outcomes, applied: server.applied.length, delivered: net.delivered, forged: forged.size } };
  } finally {
    await server.handle.close();
  }
}
