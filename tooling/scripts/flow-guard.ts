#!/usr/bin/env bun
/**
 * Flödesvakten: körs av GitHub Actions när en etikett sätts på en issue/PR.
 * Stoppar otillåtna övergångar enligt tooling/agents/flow.yaml och tar bort
 * det gamla tillståndet så att varje sak har exakt ett.
 *
 *   bun tooling/scripts/flow-guard.ts                       (händelsen i $GITHUB_EVENT_PATH)
 *   bun tooling/scripts/flow-guard.ts normalize <maskin>    (städa flera tillstånd)
 *
 * FLOW_GUARD_MODE=enforce gör ändringarna; annars (report) loggas de bara.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { parseJsonWith } from "@/lib/shared/parse-json";
import { type GitHub, gitHub } from "./flow/github";
import { loadFlow } from "./flow/load";
import type { Flow, Machine } from "./flow/schema";
import { type Decision, decide, isUlrik, normalizeRemovals, previousStateLabel } from "./flow/transition";

const payloadSchema = z.object({
  label: z.object({ name: z.string() }),
  repository: z.object({ full_name: z.string() }),
  issue: z.object({ number: z.number(), labels: z.array(z.object({ name: z.string() })) }).optional(),
  pull_request: z.object({ number: z.number(), labels: z.array(z.object({ name: z.string() })) }).optional(),
});
type Payload = z.infer<typeof payloadSchema>;

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
    const payload = parseJsonWith(payloadSchema, readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8"));
    handleLabel(flow, payload, gitHub(payload.repository.full_name), enforce, console.log);
  }
}
