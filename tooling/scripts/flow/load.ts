/**
 * Läser `tooling/agents/flow.yaml` och kontrollerar att flödet hänger ihop.
 * Formen kontrolleras av zod (`schema.ts`); här kontrolleras innehållet.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { type Flow, flowSchema, type Machine } from "./schema";

/** Buns inbyggda YAML-läsare, hämtad och kontrollerad vid körning (skripten körs alltid med bun). */
const bunYaml = z.object({
  YAML: z.object({ parse: z.custom<(text: string) => unknown>((v) => typeof v === "function") }),
});

export const FLOW_PATH = "tooling/agents/flow.yaml";

/** YAML-text → validerat flöde. Kastar vid fel form. */
export function parseFlow(text: string): Flow {
  return flowSchema.parse(bunYaml.parse(Reflect.get(globalThis, "Bun")).YAML.parse(text));
}

/** Tillståndets id för en etikett, eller null om etiketten inte är ett tillstånd. */
export function stateOfLabel(machine: Machine, label: string): string | null {
  const hit = Object.entries(machine.states).find(([, s]) => s.label === label);
  return hit ? hit[0] : null;
}

/** Alla tillståndsetiketter i maskinen. */
export function stateLabels(machine: Machine): string[] {
  return Object.values(machine.states).flatMap((s) => (s.label === null ? [] : [s.label]));
}

function targetErrors(name: string, m: Machine): string[] {
  const out: string[] = [];
  if (!(m.start in m.states)) out.push(`${name}: starttillståndet ${m.start} finns inte`);
  for (const [id, s] of Object.entries(m.states)) {
    for (const t of s.transitions) {
      if (!(t.to in m.states)) out.push(`${name}.${id}: övergången till ${t.to} pekar inte på ett tillstånd`);
    }
    if (s.timeout?.to !== undefined && !(s.timeout.to in m.states)) {
      out.push(`${name}.${id}: timeouten går till ${s.timeout.to}, som inte finns`);
    }
  }
  return out;
}

function labelErrors(name: string, m: Machine): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const label of [...stateLabels(m), ...Object.keys(m.flags)]) {
    if (seen.has(label)) out.push(`${name}: etiketten ${label} används två gånger`);
    seen.add(label);
  }
  for (const [id, s] of Object.entries(m.states)) {
    if (s.label !== null && s.color === undefined) out.push(`${name}.${id}: etiketten ${s.label} saknar färg`);
  }
  return out;
}

function reachable(m: Machine): Set<string> {
  const seen = new Set<string>([m.start]);
  const queue = [m.start];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    for (const t of m.states[id]?.transitions ?? []) {
      if (!seen.has(t.to)) { seen.add(t.to); queue.push(t.to); }
    }
  }
  return seen;
}

function reachabilityErrors(name: string, m: Machine): string[] {
  const seen = reachable(m);
  return Object.keys(m.states).filter((id) => !seen.has(id)).map((id) => `${name}.${id}: går inte att nå från ${m.start}`);
}

function agentErrors(flow: Flow, name: string, m: Machine): string[] {
  return Object.entries(m.states)
    .filter(([, s]) => s.agent !== null && !(s.agent in flow.routines))
    .map(([id, s]) => `${name}.${id}: agenten ${s.agent ?? ""} finns inte under routines`);
}

/** Etiketter med samma namn i samma repo ska ha samma färg och beskrivning. */
function sharedLabelErrors(flow: Flow): string[] {
  const byKey = new Map<string, string>();
  const out: string[] = [];
  for (const m of Object.values(flow.machines)) {
    for (const l of labelDefs(m)) {
      const key = `${m.repo} ${l.name}`;
      const value = `${l.color} ${l.description}`;
      const prev = byKey.get(key);
      if (prev !== undefined && prev !== value) out.push(`${m.repo}: etiketten ${l.name} har olika färg eller beskrivning`);
      byKey.set(key, value);
    }
  }
  return out;
}

/** En etikett som GitHub ska ha. */
export interface LabelDef { name: string; color: string; description: string }

/** Maskinens etiketter (tillstånd först, sedan flaggor) i filens ordning. */
export function labelDefs(m: Machine): LabelDef[] {
  const states = Object.values(m.states).flatMap((s) =>
    s.label === null ? [] : [{ name: s.label, color: s.color ?? "", description: s.description }]);
  const flags = Object.entries(m.flags).map(([name, f]) => ({ name, color: f.color, description: f.description }));
  return [...states, ...flags];
}

/** Allt som inte hänger ihop i flödet. Tom lista = giltigt. */
export function flowErrors(flow: Flow): string[] {
  return [
    ...Object.entries(flow.machines).flatMap(([name, m]) => [
      ...targetErrors(name, m),
      ...labelErrors(name, m),
      ...reachabilityErrors(name, m),
      ...agentErrors(flow, name, m),
    ]),
    ...sharedLabelErrors(flow),
  ];
}

/** Läser och validerar flödesfilen. Kastar om den inte hänger ihop. */
export function loadFlow(path: string = FLOW_PATH): Flow {
  const flow = parseFlow(readFileSync(path, "utf8"));
  const errors = flowErrors(flow);
  if (errors.length > 0) throw new Error(`flow.yaml hänger inte ihop:\n- ${errors.join("\n- ")}`);
  return flow;
}
