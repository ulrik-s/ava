/**
 * Allt som genereras ur flödet: etikettlistan (`tooling/agents/labels.json`,
 * som `setup-agent-labels.sh` skapar etiketterna ur) och dokumentationen med
 * diagrammen (`docs/agent-flow.md`).
 */
import { labelDefs, type LabelDef } from "./load";
import { agentAllowRules, ruleCommand } from "./permissions";
import type { Flow, Machine, State, Timeout } from "./schema";

export const LABELS_PATH = "tooling/agents/labels.json";
export const DOCS_PATH = "docs/agent-flow.md";

/** Repot → gruppnamnet i labels.json. */
const GROUP_OF_REPO: Readonly<Record<string, string>> = { "ulrik-s/ava-feedback": "intake", "ulrik-s/ava": "code" };

function groupLabels(flow: Flow): Map<string, LabelDef[]> {
  const groups = new Map<string, LabelDef[]>();
  for (const m of Object.values(flow.machines)) {
    const group = GROUP_OF_REPO[m.repo] ?? m.repo;
    const list = groups.get(group) ?? [];
    for (const l of labelDefs(m)) if (!list.some((x) => x.name === l.name)) list.push(l);
    groups.set(group, list);
  }
  return groups;
}

/** `tooling/agents/labels.json`, en etikett per rad. */
export function renderLabels(flow: Flow): string {
  const groups = [...groupLabels(flow)].map(([group, labels]) => {
    const rows = labels.map((l) =>
      `    { "name": ${JSON.stringify(l.name)}, "color": ${JSON.stringify(l.color)}, "description": ${JSON.stringify(l.description)} }`);
    return `  ${JSON.stringify(group)}: [\n${rows.join(",\n")}\n  ]`;
  });
  return `{\n${groups.join(",\n")}\n}\n`;
}

const durationText = (t: Timeout): string => t.after.replace("h", " h").replace("d", " d");

function stateBox(id: string, s: State): string {
  const label = s.label ?? "(ingen etikett)";
  const agent = s.agent === null ? "" : `<br/>${s.agent}`;
  return `  state "${label}${agent}" as ${id}`;
}

function edgeLines(id: string, s: State): string[] {
  const out = s.transitions.map((t) => {
    const who = t.by === "ulrik" ? " : Ulrik" : t.unless_flag === undefined ? "" : ` : Ulrik om ${t.unless_flag}`;
    return `  ${id} --> ${t.to}${who}`;
  });
  if (s.timeout?.to !== undefined) out.push(`  ${id} --> ${s.timeout.to} : timeout ${durationText(s.timeout)}`);
  if (s.transitions.length === 0 && s.timeout === undefined) out.push(`  ${id} --> [*]`);
  return out;
}

/** Maskinen som ett Mermaid-tillståndsdiagram. */
export function renderMermaid(m: Machine): string {
  const states = Object.entries(m.states);
  return [
    "stateDiagram-v2",
    "  direction LR",
    ...states.map(([id, s]) => stateBox(id, s)),
    `  [*] --> ${m.start}`,
    ...states.flatMap(([id, s]) => edgeLines(id, s)),
  ].join("\n");
}

const code = (s: string | null): string => (s === null ? "—" : `\`${s}\``);

function stateRow(id: string, s: State): string {
  const to = s.transitions.map((t) => (t.by === "ulrik" ? `${t.to} (Ulrik)` : t.to)).join(", ") || "—";
  const timeout = s.timeout === undefined ? "—" : `${durationText(s.timeout)} → ${s.timeout.to ?? "—"}`;
  return `| ${id} | ${code(s.label)} | ${s.agent ?? "—"} | ${to} | ${timeout} |`;
}

function machineSection(name: string, m: Machine): string {
  const flags = Object.entries(m.flags).map(([label, f]) =>
    `| \`${label}\` | ${f.by === "ulrik" ? "Ulrik" : "alla"} | ${f.timeout === undefined ? "—" : `${durationText(f.timeout)} → tas bort`} | ${f.description} |`);
  return [
    `## ${name} (\`${m.repo}\`, ${m.items})`,
    "",
    m.description,
    "",
    "```mermaid",
    renderMermaid(m),
    "```",
    "",
    "| Tillstånd | Etikett | Agent | Får gå till | Timeout |",
    "|---|---|---|---|---|",
    ...Object.entries(m.states).map(([id, s]) => stateRow(id, s)),
    "",
    "| Flagga | Får sättas av | Timeout | Betyder |",
    "|---|---|---|---|",
    ...flags,
  ].join("\n");
}

/** Tillstånden som startar rutinen, som `maskin.tillstånd`. */
function dispatchingStates(flow: Flow, id: string): string[] {
  return Object.entries(flow.machines).flatMap(([name, m]) =>
    Object.entries(m.states).filter(([, s]) => s.agent === id && s.dispatch && s.label !== null).map(([sid]) => `${name}.${sid}`));
}

/** `docs/agent-flow.md`. */
export function renderDocs(flow: Flow): string {
  const routines = Object.entries(flow.routines).map(([id, r]) => {
    const starts = [...dispatchingStates(flow, id), ...r.events].map((e) => `\`${e}\``).join("<br>") || "—";
    return `| ${id} | ${r.name} | \`${r.prompt}\` | ${starts} |`;
  });
  return [
    "<!-- GENERERAD av `bun run flow:gen` ur tooling/agents/flow.yaml — redigera inte för hand. -->",
    "# Agentkedjans flöde",
    "",
    "Varje sak har exakt ett tillstånd (en etikett). Flödesvakten",
    "(`.github/workflows/agent-flow.yml`) stoppar otillåtna övergångar, tar bort det",
    "gamla tillståndet och sköter timeouterna. Flaggor läggs ovanpå tillståndet.",
    `CI som hänger mer än ${flow.ci.hang_minutes} minuter avbryts. Står en sak längre än ${flow.nudge.after}`,
    `i ett tillstånd med en agent startas agenten igen (knuffen), utom med ${flow.nudge.skip_flags.map((f) => `\`${f}\``).join(" eller ") || "—"}.`,
    "",
    ...Object.entries(flow.machines).flatMap(([name, m]) => [machineSection(name, m), ""]),
    "## Förhandsgodkända skrivningar",
    "",
    "Agenterna skriver till GitHub med EXAKT de här formerna (N = numret, en etikett per kommando, inga",
    "`--jq` eller `$(…)`). De är förhandsgodkända i `.claude/settings.json`, som ett test håller lika med",
    "den här listan. `verifierad` och `människa-godkänd` sätter bara Ulrik.",
    "",
    "```bash",
    ...agentAllowRules(flow).map(ruleCommand),
    "```",
    "",
    "## Rutiner",
    "",
    "| Id | Rutin | Prompt | Startas av (utöver schemat) |",
    "|---|---|---|---|",
    ...routines,
    "",
  ].join("\n");
}
