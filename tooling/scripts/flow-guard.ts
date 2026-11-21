#!/usr/bin/env bun
/**
 * Flödesvakten: körs av GitHub Actions när en etikett sätts på en issue/PR.
 * Stoppar otillåtna övergångar enligt tooling/agents/flow.yaml och tar bort
 * det gamla tillståndet så att varje sak har exakt ett. När en issue stängs
 * startar den agenten för det som väntade på den (beroenden, #1720).
 *
 *   bun tooling/scripts/flow-guard.ts                       (händelsen i $GITHUB_EVENT_PATH)
 *   bun tooling/scripts/flow-guard.ts normalize <maskin>    (städa flera tillstånd)
 *
 * FLOW_GUARD_MODE=enforce gör ändringarna; annars (report) loggas de bara.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { parseJsonWith } from "@/lib/shared/parse-json";
import { dispatchTarget, earlierFire, type FetchFn, type FireTarget, fire, waitsForBlockers } from "./flow/dispatch";
import { type GitHub, gitHub, type RepoLabelEvent } from "./flow/github";
import { loadFlow } from "./flow/load";
import type { Flow, Machine } from "./flow/schema";
import { type Decision, decide, isUlrik, normalizeRemovals, previousStateLabel } from "./flow/transition";
import { openBlockers } from "./flow-deps";

const payloadSchema = z.object({
  label: z.object({ name: z.string() }),
  repository: z.object({ full_name: z.string() }),
  issue: z.object({ number: z.number(), labels: z.array(z.object({ name: z.string() })) }).optional(),
  pull_request: z.object({ number: z.number(), labels: z.array(z.object({ name: z.string() })) }).optional(),
});
type Payload = z.infer<typeof payloadSchema>;

const closedSchema = z.object({
  action: z.literal("closed"),
  repository: z.object({ full_name: z.string() }),
  issue: z.object({ number: z.number() }),
});
type ClosedPayload = z.infer<typeof closedSchema>;

/** Utskrift; injicerbar i testerna. */
export type Log = (line: string) => void;

/** Maskinen som gäller för repot och sorten (issue/PR). */
export function machineFor(flow: Flow, repo: string, items: "issues" | "pulls"): Machine | null {
  return Object.values(flow.machines).find((m) => m.repo === repo && m.items === items) ?? null;
}

function apply(gh: GitHub, n: number, d: Decision, label: string): void {
  if (d.kind === "allow") for (const l of d.remove) gh.removeLabel(n, l);
  if (d.kind !== "reject") return;
  gh.removeLabel(n, label);
  if (d.restore !== null) gh.addLabel(n, d.restore);
  gh.comment(n, `Flödesvakten: ${d.reason} Etiketten \`${label}\` togs bort. Flödet: docs/agent-flow.md`);
}

/** Hanterar en etiketthändelse. Ger beslutet. */
export function handleLabel(flow: Flow, payload: Payload, gh: GitHub, enforce: boolean, log: Log): Decision {
  const item = payload.pull_request ?? payload.issue;
  const machine = machineFor(flow, payload.repository.full_name, payload.pull_request ? "pulls" : "issues");
  if (!item || !machine) return { kind: "ignore" };
  const label = payload.label.name;
  const events = gh.labelEvents(item.number);
  const event = events.filter((e) => e.added && e.label === label).at(-1);
  if (!event) return { kind: "ignore" };
  const decision = decide(machine, {
    label,
    current: item.labels.map((l) => l.name),
    previous: previousStateLabel(events, event.id, machine),
    byUlrik: isUlrik(event, flow.ulrik),
  });
  log(`#${item.number} ${label}: ${JSON.stringify(decision)}${enforce ? "" : " (bara rapport)"}`);
  if (enforce) apply(gh, item.number, decision, label);
  return decision;
}

/** Låset: startade en tidigare etikett i fönstret redan samma rutin? Loggar i så fall. */
function startedAlready(flow: Flow, payload: Payload, target: FireTarget, events: readonly RepoLabelEvent[], log: Log): boolean {
  const repo = payload.repository.full_name;
  const own = { number: (payload.pull_request ?? payload.issue)?.number ?? -1, label: payload.label.name, isPr: !!payload.pull_request };
  const routineOf = (e: RepoLabelEvent): string | null => {
    const m = machineFor(flow, repo, e.isPr ? "pulls" : "issues");
    return m ? dispatchTarget(flow, m, e.label)?.id ?? null : null;
  };
  const prior = earlierFire(events, { own, routineId: target.id, routineOf, now: Date.now() });
  if (prior) log(`${target.id}: redan startad av #${prior.number} (${prior.label}) — hoppar över`);
  return prior !== null;
}

/**
 * Repots etiketthändelser för låset. Går de inte att läsa startas rutinen ändå
 * (#1774): hellre två körningar — L4 tar en issue med en push, och klockan
 * stänger dubblett-PR:er — än ingen, som förr när varannan läsning föll.
 */
function lockEvents(read: () => RepoLabelEvent[], log: Log): RepoLabelEvent[] {
  try {
    return read();
  } catch (e) {
    log(`låset gick inte att läsa (${e instanceof Error ? e.message : String(e)}) — startar ändå`);
    return [];
  }
}

/** Rutinen etiketten ska starta, saken den gäller och om tillståndet väntar på blockerare — eller null. */
function dispatchFor(flow: Flow, payload: Payload): { target: FireTarget; number: number; waits: boolean } | null {
  const item = payload.pull_request ?? payload.issue;
  const machine = machineFor(flow, payload.repository.full_name, payload.pull_request ? "pulls" : "issues");
  const target = machine && item ? dispatchTarget(flow, machine, payload.label.name) : null;
  return target && item && machine ? { target, number: item.number, waits: waitsForBlockers(machine, payload.label.name) } : null;
}

/**
 * Det dispatchen behöver utifrån; `recentEvents` (repots etiketthändelser) slår
 * på låset, `openBlockers` (sakens öppna GitHub-beroenden) på väntan.
 */
export interface DispatchIo {
  fetch: FetchFn;
  log: Log;
  recentEvents?: () => RepoLabelEvent[];
  openBlockers?: (n: number) => number[];
}

/** Har saken öppna blockerare i ett tillstånd som väntar på dem? Loggar i så fall. */
function heldBack(found: { target: FireTarget; number: number; waits: boolean }, io: DispatchIo): boolean {
  const blockers = found.waits && io.openBlockers ? io.openBlockers(found.number) : [];
  if (blockers.length > 0) {
    io.log(`#${found.number}: väntar på ${blockers.map((b) => `#${b}`).join(", ")} — ${found.target.id} startas när de är klara`);
  }
  return blockers.length > 0;
}

/** Startar agenten för tillståndet som etiketten satte. Ger true om den startades. */
export async function dispatchLabel(
  flow: Flow, payload: Payload, env: Readonly<Record<string, string | undefined>>, io: DispatchIo,
): Promise<boolean> {
  const found = dispatchFor(flow, payload);
  if (!found) return false;
  const { target } = found;
  if (heldBack(found, io)) return false;
  if (io.recentEvents && startedAlready(flow, payload, target, lockEvents(io.recentEvents, io.log), io.log)) return false;
  const text = `Flödesvakten: ${payload.repository.full_name}#${found.number} gick in i tillståndet ${payload.label.name}.`;
  return fire(target, text, env[`ROUTINE_TOKEN_${target.id}`], io.fetch, io.log);
}

/** Rutinen som ska startas för en sak som väntade på blockerare och inte har några kvar, eller null. */
function unblockedTarget(flow: Flow, machine: Machine, gh: GitHub, d: { number: number; labels: readonly string[] }): FireTarget | null {
  const label = d.labels.find((l) => waitsForBlockers(machine, l));
  const target = label === undefined ? null : dispatchTarget(flow, machine, label);
  return target && gh.blockers(d.number).length === 0 ? target : null;
}

/**
 * En issue stängdes. Var den sista blockeraren för något som väntar, startas
 * dess agent nu — en gång per rutin, som tar alla saker i sitt tillstånd.
 * Ger antalet startade rutiner.
 */
export async function dispatchUnblocked(
  flow: Flow, payload: ClosedPayload, gh: GitHub, env: Readonly<Record<string, string | undefined>>, io: DispatchIo,
): Promise<number> {
  const machine = machineFor(flow, payload.repository.full_name, "issues");
  if (!machine) return 0;
  const started = new Set<string>();
  for (const d of gh.blocked(payload.issue.number)) {
    const target = unblockedTarget(flow, machine, gh, d);
    if (!target || started.has(target.id)) continue;
    started.add(target.id);
    const text = `Flödesvakten: ${payload.repository.full_name}#${d.number} är inte längre blockerad (#${payload.issue.number} stängdes).`;
    await fire(target, text, env[`ROUTINE_TOKEN_${target.id}`], io.fetch, io.log);
  }
  return started.size;
}

/** Städar alla öppna saker i en maskin till ett tillstånd var. Ger antal ändrade. */
export function normalize(machine: Machine, gh: GitHub, enforce: boolean, log: Log): number {
  let changed = 0;
  for (const item of gh.openItems().filter((i) => i.isPr === (machine.items === "pulls"))) {
    const remove = normalizeRemovals(machine, item.labels);
    if (remove.length === 0) continue;
    changed++;
    log(`#${item.number}: tar bort ${remove.join(", ")}${enforce ? "" : " (bara rapport)"}`);
    if (enforce) for (const l of remove) gh.removeLabel(item.number, l);
  }
  return changed;
}

if (import.meta.main) {
  const flow = loadFlow();
  const enforce = process.env.FLOW_GUARD_MODE === "enforce";
  const [cmd, name] = process.argv.slice(2);
  if (cmd === "normalize") {
    const machine = name === undefined ? undefined : flow.machines[name];
    if (!machine) { console.error(`Okänd maskin: ${name ?? ""}`); process.exit(2); }
    normalize(machine, gitHub(machine.repo), enforce, console.log);
  } else {
    const raw = readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8");
    if (parseJsonWith(z.object({ action: z.string().optional() }), raw).action === "closed") {
      const closed = parseJsonWith(closedSchema, raw);
      if (enforce) await dispatchUnblocked(flow, closed, gitHub(closed.repository.full_name), process.env, { fetch, log: console.log });
    } else {
      const payload = parseJsonWith(payloadSchema, raw);
      const gh = gitHub(payload.repository.full_name);
      const decision = handleLabel(flow, payload, gh, enforce, console.log);
      if (enforce && decision.kind === "allow") {
        await dispatchLabel(flow, payload, process.env, {
          fetch, log: console.log, recentEvents: () => gh.recentLabelEvents(),
          // Går beroendena inte att läsa startas agenten ändå; loop 4 kontrollerar dem själv.
          openBlockers: (n) => {
            try { return openBlockers(gh, n, { enforce, log: console.log }); } catch (e) { console.log(`beroenden: ${e instanceof Error ? e.message : String(e)}`); return []; }
          },
        });
      }
    }
  }
}
