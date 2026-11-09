/**
 * {@link IFeedbackSink} mot GitHubs REST-API — intag-repot för användarnas
 * buggar och förslag.
 *
 * Token: en finkornig PAT (eller GitHub App-token) med BARA `Issues: write` på
 * intag-repot. Den ligger i serverns env och lämnar aldrig servern; klienten
 * når GitHub enbart via `feedback`-routern.
 */

import { z } from "zod";
import type { FeedbackIssue, IFeedbackSink } from "../ports";

const API = "https://api.github.com";
/** `owner/repo` — inga konstigheter som kan bryta sig ut ur URL:en. */
const REPO = /^[\w.-]+\/[\w.-]+$/;

export interface FeedbackConfig {
  token: string;
  repo: string;
}

/** Konfigurationen ur env, eller null (= knappen av). */
export function feedbackConfigFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): FeedbackConfig | null {
  const token = env.AVA_FEEDBACK_GITHUB_TOKEN?.trim();
  const repo = env.AVA_FEEDBACK_REPO?.trim();
  if (!token || !repo) return null;
  if (!REPO.test(repo)) throw new Error(`AVA_FEEDBACK_REPO ska vara owner/repo, inte "${repo}"`);
  return { token, repo };
}

const issueSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable(),
  state: z.string(),
  created_at: z.string(),
  labels: z.array(z.object({ name: z.string() })),
  pull_request: z.unknown().optional(),
});

/** Det enda av `fetch` adaptern använder — lätt att ersätta i tester. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class GithubFeedbackSink implements IFeedbackSink {
  constructor(private readonly config: FeedbackConfig, private readonly fetchImpl: FetchLike = fetch) {}

  private async call(path: string, init?: RequestInit): Promise<unknown> {
    const res = await this.fetchImpl(`${API}/repos/${this.config.repo}${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.config.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ava-feedback",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    // Svaret kan innehålla repo-detaljer men aldrig token; status räcker i felet.
    if (!res.ok) throw new Error(`GitHub svarade ${res.status} på ${init?.method ?? "GET"} ${path}`);
    return res.json();
  }

  async create(issue: { title: string; body: string; labels: string[] }): Promise<{ number: number }> {
    const created = z.object({ number: z.number() }).parse(await this.call("/issues", { method: "POST", body: JSON.stringify(issue) }));
    return { number: created.number };
  }

  // ponytail: bara de 100 senaste förfrågningarna — räcker för en byrå; sidbläddra om listan växer förbi det.
  async list(): Promise<FeedbackIssue[]> {
    const rows = z.array(issueSchema).parse(await this.call("/issues?labels=user-request&state=all&per_page=100&sort=created"));
    return rows.filter((r) => r.pull_request === undefined).map((r) => ({
      number: r.number,
      title: r.title,
      body: r.body ?? "",
      open: r.state === "open",
      labels: r.labels.map((l) => l.name),
      createdAt: r.created_at,
    }));
  }
}
