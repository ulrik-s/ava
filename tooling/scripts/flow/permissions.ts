/**
 * Agenternas skrivningar till GitHub, förhandsgodkända (#1557). Listan räknas
 * fram ur flödet, så att en agent aldrig nekas något flödet tillåter — och
 * aldrig får något det inte tillåter: `verifierad` och `människa-godkänd`
 * (bara Ulrik) finns inte med. `.claude/settings.json` ska innehålla exakt
 * den här listan; ett test fäller annars. Filen skrivs av Ulrik (agenter och
 * Claude får inte ändra sina egna behörigheter).
 */
import { stateLabels } from "./load";
import type { Flow, Machine } from "./schema";

export const SETTINGS_PATH = ".claude/settings.json";

/** Klockans workflow i varje repo (startas av L1 och L6). */
const CLOCK_WORKFLOW: Readonly<Record<string, string>> = {
  "ulrik-s/ava": "agent-flow.yml",
  "ulrik-s/ava-feedback": "flodesvakt.yml",
};

/** Etiketter en agent får sätta: tillstånd som en agent kan gå in i, och fria flaggor. */
function settable(m: Machine): string[] {
  const byAgent = new Set(Object.values(m.states).flatMap((s) => s.transitions.filter((t) => t.by === "any").map((t) => t.to)));
  const states = Object.entries(m.states).flatMap(([id, s]) => (s.label !== null && byAgent.has(id) ? [s.label] : []));
  return [...states, ...Object.entries(m.flags).flatMap(([l, f]) => (f.by === "any" ? [l] : []))];
}

/** Etiketter en agent får ta bort: alla tillstånd och de fria flaggorna. */
function removable(m: Machine): string[] {
  return [...stateLabels(m), ...Object.entries(m.flags).flatMap(([l, f]) => (f.by === "any" ? [l] : []))];
}

const add = (repo: string, label: string): string => `Bash(gh api repos/${repo}/issues/*/labels -f 'labels[]=${label}')`;
const del = (repo: string, label: string): string => `Bash(gh api -X DELETE repos/${repo}/issues/*/labels/${encodeURIComponent(label)})`;

function repoRules(flow: Flow, repo: string): string[] {
  const machines = Object.values(flow.machines).filter((m) => m.repo === repo);
  const out = [
    ...machines.flatMap((m) => settable(m).map((l) => add(repo, l))),
    ...machines.flatMap((m) => removable(m).map((l) => del(repo, l))),
  ];
  const clock = CLOCK_WORKFLOW[repo];
  if (clock) out.push(`Bash(gh api -X POST repos/${repo}/actions/workflows/${clock}/dispatches -f ref=main)`);
  if (machines.some((m) => m.items === "pulls")) out.push(`Bash(gh api -X PUT repos/${repo}/pulls/*/merge -f merge_method=squash -f sha=*)`);
  return out;
}

/** Leveransen i intaget: release-etiketten och kommentarerna (privat repo). */
function intakeRules(repo: string): string[] {
  return [
    add(repo, "release:v*"),
    `Bash(gh api repos/${repo}/labels -f name=release:v* -f color=0e8a16)`,
    `Bash(gh api repos/${repo}/issues/*/comments -F body=@*)`,
  ];
}

/** Hela listan, sorterad och utan dubbletter. */
export function agentAllowRules(flow: Flow): string[] {
  const repos = [...new Set(Object.values(flow.machines).map((m) => m.repo))];
  const intake = flow.machines.intake?.repo;
  const rules = [...repos.flatMap((r) => repoRules(flow, r)), ...(intake ? intakeRules(intake) : [])];
  return [...new Set(rules)].sort();
}

/** `.claude/settings.json` som den ska se ut. */
export function renderSettings(flow: Flow): string {
  return `${JSON.stringify({
    $schema: "https://json.schemastore.org/claude-code-settings.json",
    permissions: { allow: agentAllowRules(flow) },
  }, null, 2)}\n`;
}

/** Kommandot ur en regel, som agenterna skriver det (`*` → platshållare). */
export function ruleCommand(rule: string): string {
  return rule.replace(/^Bash\(/, "").replace(/\)$/, "").replace("issues/*/", "issues/N/").replace("pulls/*/", "pulls/N/");
}
