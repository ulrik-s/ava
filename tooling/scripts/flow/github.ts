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
  title: z.string().default(""),
  body: z.string().nullable().default(""),
  labels: z.array(z.object({ name: z.string() })),
  pull_request: z.unknown().optional(),
});

const lastRunSchema = z.object({ workflow_runs: z.array(z.object({ created_at: z.string(), conclusion: z.string().nullable(), head_sha: z.string() })) });
const releaseSchema = z.object({ tag_name: z.string(), created_at: z.string() });
const compareSchema = z.object({ commits: z.array(z.object({ commit: z.object({ message: z.string() }) })) });

const runsSchema = z.object({
  workflow_runs: z.array(z.object({ id: z.number(), status: z.string(), run_started_at: z.string() })),
});

/** En etiketthändelse med tidpunkt. */
export interface TimedLabelEvent extends LabelEvent { at: string }

/** En öppen issue eller PR. */
export interface OpenItem { number: number; title: string; body: string; labels: string[]; isPr: boolean }

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
      return pages.flat().map((i) => ({ number: i.number, title: i.title, body: i.body ?? "", labels: i.labels.map((l) => l.name), isPr: i.pull_request !== undefined }));
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
    prMergeState(n: number): string {
      return parseJsonWith(z.object({ mergeable_state: z.string() }), run(["api", `repos/${repo}/pulls/${n}`])).mergeable_state;
    },
    /** Senaste körningen av en workflow, eller null. `filter` är t.ex. `branch=main` eller `event=schedule`. */
    lastRun(workflow: string, filter?: string): { at: string; conclusion: string | null; sha: string } | null {
      const q = filter === undefined ? "" : `&${filter}`;
      const r = parseJsonWith(lastRunSchema, run(["api", `repos/${repo}/actions/workflows/${workflow}/runs?per_page=1${q}`])).workflow_runs[0];
      return r ? { at: r.created_at, conclusion: r.conclusion, sha: r.head_sha } : null;
    },
    latestRelease(): { tag: string; at: string } {
      const r = parseJsonWith(releaseSchema, run(["api", `repos/${repo}/releases/latest`]));
      return { tag: r.tag_name, at: r.created_at };
    },
    mainSha(): string {
      return parseJsonWith(z.object({ sha: z.string() }), run(["api", `repos/${repo}/commits/main`])).sha;
    },
    /** Commit-rubrikerna mellan `from` och main. */
    subjectsSince(from: string): string[] {
      return parseJsonWith(compareSchema, run(["api", `repos/${repo}/compare/${from}...main`])).commits.map((c) => c.commit.message.split("\n")[0] ?? "");
    },
    createTag(tag: string, sha: string): void { run(["api", `repos/${repo}/git/refs`, "-f", `ref=refs/tags/${tag}`, "-f", `sha=${sha}`]); },
    dispatch(workflow: string, ref: string): void { run(["api", "-X", "POST", `repos/${repo}/actions/workflows/${workflow}/dispatches`, "-f", `ref=${ref}`]); },
    createIssue(title: string, body: string, label: string): void { run(["api", `repos/${repo}/issues`, "-f", `title=${title}`, "-f", `body=${body}`, "-f", `labels[]=${label}`]); },
    setBody(n: number, body: string): void { run(["api", "-X", "PATCH", `repos/${repo}/issues/${n}`, "-f", `body=${body}`]); },
    addLabel(n: number, label: string): void { run(["api", `repos/${repo}/issues/${n}/labels`, "-f", `labels[]=${label}`]); },
    /** Ta bort en etikett. Är den redan borta (404) är målet nått — inget fel. */
    removeLabel(n: number, label: string): void {
      try {
        run(["api", "-X", "DELETE", `repos/${repo}/issues/${n}/labels/${enc(label)}`]);
      } catch (e) {
        if (!(e instanceof Error && e.message.includes("HTTP 404"))) throw e;
      }
    },
    comment(n: number, body: string): void { run(["api", `repos/${repo}/issues/${n}/comments`, "-f", `body=${body}`]); },
    cancelRun(id: number): void { run(["api", "-X", "POST", `repos/${repo}/actions/runs/${id}/cancel`]); },
  };
}

/** Operationerna mot ett repo. */
export type GitHub = ReturnType<typeof gitHub>;
