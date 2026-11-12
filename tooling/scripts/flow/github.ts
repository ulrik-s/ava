/**
 * GitHub-anropen flödesvakten behöver, via `gh api`. Körningen av `gh` är
 * injicerbar så att vakten kan testas utan nätverk.
 */
import { spawnSync } from "node:child_process";
import { z } from "zod";
import { parseJsonWith } from "@/lib/shared/parse-json";
import type { LabelEvent } from "./transition";
import type { CiRun } from "./watchdog";

/** Kör `gh` med argumenten och ger stdout. */
export type GhRunner = (args: readonly string[]) => string;

/** Den riktiga `gh`. */
export const runGh: GhRunner = (args) => {
  const r = spawnSync("gh", [...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`gh ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};

const eventSchema = z.object({
  id: z.number(),
  event: z.string(),
  created_at: z.string(),
  label: z.object({ name: z.string() }).optional(),
  actor: z.object({ login: z.string() }).nullable(),
  performed_via_github_app: z.unknown().nullable().optional(),
});
const pagesSchema = <T extends z.ZodType>(item: T) => z.array(z.array(item));

const itemSchema = z.object({
  number: z.number(),
  labels: z.array(z.object({ name: z.string() })),
  pull_request: z.unknown().optional(),
});

const runsSchema = z.object({
  workflow_runs: z.array(z.object({ id: z.number(), status: z.string(), run_started_at: z.string() })),
});

/** En etiketthändelse med tidpunkt. */
export interface TimedLabelEvent extends LabelEvent { at: string }

/** En öppen issue eller PR. */
export interface OpenItem { number: number; labels: string[]; isPr: boolean }

const enc = (label: string): string => encodeURIComponent(label);

/** GitHub-operationerna för ett repo. */
export function gitHub(repo: string, run: GhRunner = runGh) {
  return {
    labelEvents(n: number): TimedLabelEvent[] {
      const pages = parseJsonWith(pagesSchema(eventSchema), run(["api", `repos/${repo}/issues/${n}/events?per_page=100`, "--paginate", "--slurp"]));
      return pages.flat().flatMap((e) =>
        (e.event === "labeled" || e.event === "unlabeled") && e.label
          ? [{ id: e.id, label: e.label.name, added: e.event === "labeled", actor: e.actor?.login ?? "", viaApp: e.performed_via_github_app != null, at: e.created_at }]
          : []);
    },
    openItems(): OpenItem[] {
      const pages = parseJsonWith(pagesSchema(itemSchema), run(["api", `repos/${repo}/issues?state=open&per_page=100`, "--paginate", "--slurp"]));
      return pages.flat().map((i) => ({ number: i.number, labels: i.labels.map((l) => l.name), isPr: i.pull_request !== undefined }));
    },
    hasOpenPr(n: number): boolean {
      const r = parseJsonWith(z.object({ total_count: z.number() }), run(["api", "-X", "GET", "search/issues", "-f", `q=repo:${repo} is:pr is:open "Closes #${n}"`]));
      return r.total_count > 0;
    },
    activeRuns(): CiRun[] {
      return ["queued", "in_progress"].flatMap((status) =>
        parseJsonWith(runsSchema, run(["api", `repos/${repo}/actions/runs?status=${status}&per_page=100`]))
          .workflow_runs.map((r) => ({ id: r.id, status: r.status, startedAt: r.run_started_at })));
    },
    addLabel(n: number, label: string): void { run(["api", `repos/${repo}/issues/${n}/labels`, "-f", `labels[]=${label}`]); },
    removeLabel(n: number, label: string): void { run(["api", "-X", "DELETE", `repos/${repo}/issues/${n}/labels/${enc(label)}`]); },
    comment(n: number, body: string): void { run(["api", `repos/${repo}/issues/${n}/comments`, "-f", `body=${body}`]); },
    cancelRun(id: number): void { run(["api", "-X", "POST", `repos/${repo}/actions/runs/${id}/cancel`]); },
  };
}

/** Operationerna mot ett repo. */
export type GitHub = ReturnType<typeof gitHub>;
