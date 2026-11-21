/**
 * GitHub-anropen flödesvakten behöver, via `gh api`. Körningen av `gh` är
 * injicerbar så att vakten kan testas utan nätverk.
 */
import { spawnSync } from "node:child_process";
import { z } from "zod";
import { parseJsonWith } from "@/lib/shared/parse-json";
import type { LabelEvent } from "./transition";
import { type CiRun, closesIssue, type MergedPull } from "./watchdog";

/** Kör `gh` med argumenten och ger stdout. */
export type GhRunner = (args: readonly string[]) => string;

/**
 * Utdatagränsen för `gh` (#1774). spawnSync:s standard är 1 MB, men en sida
 * ur ava:s händelselogg (100 händelser, var och en med issuens text) var
 * 1,1 MB: gh dödades tyst, felet saknade text, och vakten startade ingen
 * agent — varannan etikett i ava, så allt väntade på knuffen.
 */
const MAX_GH_OUTPUT = 64 * 1024 * 1024;

/** Varför `gh` misslyckades: dess egen text, annars processfelet eller hur den avslutades. */
export function ghFailure(r: { status: number | null; signal: string | null; stderr: string; error?: Error }): string {
  return r.stderr.trim() || r.error?.message || `avslutades med ${r.signal ?? String(r.status)}`;
}

const runner = (env: NodeJS.ProcessEnv): GhRunner => (args) => {
  const r = spawnSync("gh", [...args], { encoding: "utf8", env, maxBuffer: MAX_GH_OUTPUT });
  if (r.status !== 0) throw new Error(`gh ${args.join(" ")}: ${ghFailure(r)}`);
  return r.stdout;
};

/** Den riktiga `gh`. */
export const runGh: GhRunner = runner(process.env);

/** `gh` med en annan token: flytten till inkorgen kräver en som når båda repona. */
export const runGhWithToken = (token: string): GhRunner => runner({ ...process.env, GH_TOKEN: token });

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
  id: z.number().optional(),
  number: z.number(),
  title: z.string().default(""),
  body: z.string().nullable().default(""),
  labels: z.array(z.object({ name: z.string() })),
  pull_request: z.unknown().optional(),
  created_at: z.string().optional(),
  /** Bara på issues: antalet ÖPPNA blockerare (`blocked_by`) och öppna saker den blockerar. */
  issue_dependencies_summary: z.object({ blocked_by: z.number(), blocking: z.number() }).nullable().optional(),
  node_id: z.string().optional(),
});
type ItemRow = z.infer<typeof itemSchema>;

/** En issue i ett beroende (GitHubs `blocked_by`/`blocking`). */
const depSchema = z.object({ id: z.number(), number: z.number(), state: z.string(), repository_url: z.string(), labels: z.array(z.object({ name: z.string() })) });

const mergedSearchSchema = z.object({
  items: z.array(z.object({ number: z.number(), body: z.string().nullable(), pull_request: z.object({ merged_at: z.string().nullable() }) })),
});

const lastRunSchema = z.object({ workflow_runs: z.array(z.object({ created_at: z.string(), conclusion: z.string().nullable(), head_sha: z.string() })) });
const releaseSchema = z.object({ tag_name: z.string(), created_at: z.string() });
const compareSchema = z.object({ commits: z.array(z.object({ commit: z.object({ message: z.string() }) })) });

const runsSchema = z.object({
  workflow_runs: z.array(z.object({ id: z.number(), status: z.string(), run_started_at: z.string() })),
});

/** En etiketthändelse med tidpunkt. */
export interface TimedLabelEvent extends LabelEvent { at: string }

/** Öppna beroenden: blockerare som inte är stängda, och öppna saker den blockerar. */
export interface Deps { blockedBy: number; blocking: number }

/** En öppen issue eller PR. `id` (inte numret) behövs för att lägga till ett beroende, `nodeId` (GraphQL) för projekttavlan. */
export interface OpenItem { number: number; title: string; body: string; labels: string[]; isPr: boolean; createdAt?: string; id?: number; nodeId?: string; deps?: Deps }

/** En öppen issue i ett beroende: nummer, id och etiketter. */
export interface DepIssue { number: number; id: number; labels: string[] }

function toOpenItem(i: ItemRow): OpenItem {
  const deps = i.issue_dependencies_summary;
  return {
    number: i.number, title: i.title, body: i.body ?? "", labels: i.labels.map((l) => l.name), isPr: i.pull_request !== undefined,
    ...(i.created_at === undefined ? {} : { createdAt: i.created_at }),
    ...(i.id === undefined ? {} : { id: i.id }),
    ...(i.node_id === undefined ? {} : { nodeId: i.node_id }),
    ...(deps ? { deps: { blockedBy: deps.blocked_by, blocking: deps.blocking } } : {}),
  };
}

const repoEventSchema = z.object({
  id: z.number(),
  event: z.string(),
  created_at: z.string(),
  label: z.object({ name: z.string() }).optional(),
  issue: z.object({ number: z.number(), pull_request: z.unknown().optional() }).nullable().optional(),
});

/** En etikett som satts någonstans i repot (repots händelselogg). */
export interface RepoLabelEvent { id: number; label: string; number: number; isPr: boolean; at: string }

const enc = (label: string): string => encodeURIComponent(label);

/** Förfrågan en arbetsorder pekar på (`Intag: <intagsrepo>#N` på egen rad, loop 2), eller null. */
export function intakeRefOf(body: string, intakeRepo: string): number | null {
  const name = intakeRepo.split("/")[1] ?? intakeRepo;
  const n = new RegExp(`^Intag: ${name}#(\\d+)\\s*$`, "m").exec(body)?.[1];
  return n === undefined ? null : Number(n);
}

/** `gh api --paginate --slurp` på en sökning: en lista med sidor. */
const searchPagesSchema = z.array(z.object({ items: z.array(z.object({ body: z.string().nullable(), state: z.string(), state_reason: z.string().nullable().optional() })) }));

/** Arbetsordrarnas framsteg per förfrågan: klara (stängda som completed) av alla. */
export type WorkOrderProgress = Map<number, { done: number; total: number }>;

function openDeps(run: GhRunner, repo: string, n: number, kind: "blocked_by" | "blocking"): DepIssue[] {
  const rows = parseJsonWith(z.array(depSchema), run(["api", `repos/${repo}/issues/${n}/dependencies/${kind}?per_page=100`]));
  return rows
    .filter((r) => r.state === "open" && r.repository_url.endsWith(`/repos/${repo}`))
    .map((r) => ({ number: r.number, id: r.id, labels: r.labels.map((l) => l.name) }));
}

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
    /** Repots senaste etiketthändelser (nyast först, en sida) — låset för rutinstarter. */
    recentLabelEvents(): RepoLabelEvent[] {
      const rows = parseJsonWith(z.array(repoEventSchema), run(["api", `repos/${repo}/issues/events?per_page=100`]));
      return rows.flatMap((e) => (e.event === "labeled" && e.label && e.issue
        ? [{ id: e.id, label: e.label.name, number: e.issue.number, isPr: e.issue.pull_request != null, at: e.created_at }]
        : []));
    },
    /** Öppna PR:er via PR-ändpunkten (issuelistan räcker inte för alla tokens). */
    openPulls(): OpenItem[] {
      const pages = parseJsonWith(pagesSchema(itemSchema), run(["api", `repos/${repo}/pulls?state=open&per_page=100`, "--paginate", "--slurp"]));
      return pages.flat().map((p) => ({ number: p.number, title: p.title, body: p.body ?? "", labels: p.labels.map((l) => l.name), isPr: true, createdAt: p.created_at ?? "" }));
    },
    /** Den senast mergade PR:en som stänger issuen (`Closes #n`), eller null. */
    mergedPullClosing(n: number): MergedPull | null {
      const r = parseJsonWith(mergedSearchSchema, run(["api", "-X", "GET", "search/issues", "-f", `q=repo:${repo} is:pr is:merged "Closes #${n}"`]));
      const hits = r.items.flatMap((i) => (i.pull_request.merged_at !== null && closesIssue(i.body ?? "") === n
        ? [{ number: i.number, mergedAt: i.pull_request.merged_at }]
        : []));
      return hits.sort((a, b) => b.mergedAt.localeCompare(a.mergedAt))[0] ?? null;
    },
    /** Flyttar issuen till ett annat repo (`gh issue transfer`). Ger dess nya nummer där. */
    transferIssue(n: number, to: string): number {
      const url = run(["issue", "transfer", String(n), to, "-R", repo]).trim();
      const num = Number(/\/issues\/(\d+)$/.exec(url)?.[1]);
      if (!Number.isInteger(num) || num <= 0) throw new Error(`oväntat svar från gh issue transfer: ${url}`);
      return num;
    },
    closePull(n: number): void { run(["api", "-X", "PATCH", `repos/${repo}/pulls/${n}`, "-f", "state=closed"]); },
    closeIssue(n: number, reason: "completed" | "not_planned"): void {
      run(["api", "-X", "PATCH", `repos/${repo}/issues/${n}`, "-f", "state=closed", "-f", `state_reason=${reason}`]);
    },
    openItems(): OpenItem[] {
      const pages = parseJsonWith(pagesSchema(itemSchema), run(["api", `repos/${repo}/issues?state=open&per_page=100`, "--paginate", "--slurp"]));
      return pages.flat().map(toOpenItem);
    },
    /** Öppna issues i repot som blockerar `n` (GitHub-beroenden). */
    blockers(n: number): DepIssue[] { return openDeps(run, repo, n, "blocked_by"); },
    /** Öppna issues i repot som `n` blockerar. */
    blocked(n: number): DepIssue[] { return openDeps(run, repo, n, "blocking"); },
    /** `n` kan inte byggas förrän issuen med id `blockerId` är klar. GitHub vägrar cirklar (HTTP 422). */
    addBlocker(n: number, blockerId: number): void {
      run(["api", "-X", "POST", `repos/${repo}/issues/${n}/dependencies/blocked_by`, "-F", `issue_id=${blockerId}`]);
    },
    /** Arbetsordrarna i det här repot per förfrågan i `intakeRepo` (en sökning). */
    workOrders(intakeRepo: string): WorkOrderProgress {
      const name = intakeRepo.split("/")[1] ?? intakeRepo;
      const rows = parseJsonWith(searchPagesSchema, run(["api", "-X", "GET", "search/issues", "-f", `q=repo:${repo} is:issue "Intag: ${name}" in:body`, "-f", "per_page=100", "--paginate", "--slurp"])).flatMap((pg) => pg.items);
      const out: WorkOrderProgress = new Map();
      for (const r of rows) {
        const n = intakeRefOf(r.body ?? "", intakeRepo);
        if (n === null) continue;
        const p = out.get(n) ?? { done: 0, total: 0 };
        out.set(n, { done: p.done + (r.state === "closed" && r.state_reason === "completed" ? 1 : 0), total: p.total + 1 });
      }
      return out;
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
