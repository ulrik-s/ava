#!/usr/bin/env bun
/**
 * Beroendenätet i ava (se `flow/dependencies.ts`): speglar arbetsordrarnas
 * `Beror på #N` som GitHub-beroenden och sätter den effektiva prioriteten
 * (`prio-*`). Körs av flödesvaktens klocka; vakten speglar en enskild issue
 * innan den startar loop 4.
 *
 *   FLOW_GUARD_MODE=enforce bun tooling/scripts/flow-deps.ts
 *
 * Utan FLOW_GUARD_MODE=enforce loggas bara vad som skulle göras.
 */
import { type Edge, effectivePrio, isCycleError, missingEdges, type NewEdge, ownPrio, prioChange } from "./flow/dependencies";
import { type GitHub, gitHub, type OpenItem } from "./flow/github";
import { prioOrder } from "./flow/health";
import { loadFlow } from "./flow/load";

/** Utskrift; injicerbar i testerna. */
type Log = (line: string) => void;

/** Läge och utskrift. */
export interface DepsOpts { enforce: boolean; log: Log }

/** De öppna issuernas id per nummer. */
const idsOf = (open: readonly OpenItem[]): Map<number, number> =>
  new Map(open.flatMap((i) => (i.id === undefined ? [] : [[i.number, i.id] as const])));

const cycleComment = (n: number, blocker: number): string =>
  `Flödesvakten: \`Beror på #${blocker}\` skulle ge ett cirkulärt beroende — #${blocker} väntar redan, direkt eller via andra, på #${n}. ` +
  "Ingen av dem kan då byggas. Ta bort raden (eller beroendet åt andra hållet) och sedan `blockerad`.";

function blockCycle(gh: GitHub, item: OpenItem, blocker: number, log: Log): void {
  log(`#${item.number}: beror på #${blocker} skulle ge en cirkel — blockeras`);
  if (item.labels.includes("blockerad")) return;
  gh.addLabel(item.number, "blockerad");
  gh.comment(item.number, cycleComment(item.number, blocker));
}

function addEdge(gh: GitHub, item: OpenItem, e: NewEdge, log: Log): boolean {
  try {
    gh.addBlocker(e.blocked, e.blockerId);
    return true;
  } catch (err) {
    if (!isCycleError(err)) throw err;
    blockCycle(gh, item, e.blocker, log);
    return false;
  }
}

/**
 * Speglar en issues `Beror på #N` som GitHub-beroenden. Ger kanterna som lades
 * till (i rapportläge: som skulle läggas till). En cirkel blockerar issuen.
 */
export function mirror(gh: GitHub, item: OpenItem, existing: readonly Edge[], openIds: ReadonlyMap<number, number>, opts: DepsOpts): Edge[] {
  return missingEdges(item, existing, openIds).filter((e) => {
    opts.log(`#${e.blocked}: beror på #${e.blocker} → GitHub-beroende${opts.enforce ? "" : " (bara rapport)"}`);
    return !opts.enforce || addEdge(gh, item, e, opts.log);
  });
}

/** Öppna blockerare för `n`, efter att dess `Beror på`-rader speglats. Vakten frågar innan den startar loop 4. */
export function openBlockers(gh: GitHub, n: number, opts: DepsOpts): number[] {
  const open = gh.openItems().filter((i) => !i.isPr);
  const before = gh.blockers(n).map((b) => ({ blocker: b.number, blocked: n }));
  const added = open.filter((i) => i.number === n).flatMap((i) => mirror(gh, i, before, idsOf(open), opts));
  return [...before, ...added].map((e) => e.blocker);
}

/** Sätter den effektiva prioriteten som etikett där den skiljer sig. Ger ändringarna. */
function applyPrio(gh: GitHub, open: readonly OpenItem[], edges: readonly Edge[], order: readonly string[], opts: DepsOpts): Array<{ number: number; prio: string }> {
  const own = new Map(open.flatMap((i) => {
    const p = ownPrio(i.body, order);
    return p === null ? [] : [[i.number, p] as const];
  }));
  const eff = effectivePrio(own, edges, order);
  return open.flatMap((i) => {
    const want = eff.get(i.number);
    if (want === undefined) return [];
    const { add, remove } = prioChange(i.labels, want, order);
    if (add === null && remove.length === 0) return [];
    opts.log(`#${i.number}: ${want}${own.get(i.number) === want ? "" : " (ärvd)"}${opts.enforce ? "" : " (bara rapport)"}`);
    if (opts.enforce) setLabels(gh, i.number, add, remove);
    return [{ number: i.number, prio: want }];
  });
}

function setLabels(gh: GitHub, n: number, add: string | null, remove: readonly string[]): void {
  for (const l of remove) gh.removeLabel(n, l);
  if (add !== null) gh.addLabel(n, add);
}

/** Vad en körning gjorde. */
export interface DepsResult { added: Edge[]; prio: Array<{ number: number; prio: string }> }

/** Klockans del: spegla alla öppna issuers `Beror på`, sätt den effektiva prioriteten. */
export function runDependencies(gh: GitHub, order: readonly string[], opts: DepsOpts): DepsResult {
  const open = gh.openItems().filter((i) => !i.isPr);
  const edges = open.flatMap((i) => ((i.deps?.blockedBy ?? 0) > 0 ? gh.blockers(i.number).map((b) => ({ blocker: b.number, blocked: i.number })) : []));
  const ids = idsOf(open);
  const added = open.flatMap((i) => mirror(gh, i, edges, ids, opts));
  return { added, prio: applyPrio(gh, open, [...edges, ...added], order, opts) };
}

if (import.meta.main) {
  const flow = loadFlow();
  const repo = flow.machines["code-issue"]?.repo ?? "ulrik-s/ava";
  const r = runDependencies(gitHub(repo), prioOrder(flow), { enforce: process.env.FLOW_GUARD_MODE === "enforce", log: console.log });
  console.log(`beroenden: ${r.added.length} nya, prioritet: ${r.prio.length} ändrade`);
}
