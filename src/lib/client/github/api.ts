"use client";

/**
 * Tunna wrappers runt GitHub:s git-database REST-endpoints. ALLA går
 * mot api.github.com som har CORS `*` — ingen proxy behövs.
 *
 * Rate-limit: 5000 req/timme med auth (15000 för GitHub Enterprise).
 * Vi använder så få calls som möjligt: tree?recursive=1 i ett anrop,
 * parallella blob-fetches, bara skapade objekt postas.
 */

import { z } from "zod";
import { omitUndefined } from "@/lib/shared/omit-undefined";

const API = "https://api.github.com";

export interface RepoLocator {
  owner: string;
  repo: string;
}

interface ApiOpts {
  token: string;
  signal?: AbortSignal;
}

// Zod vid parsegränsen (#187): GitHub-API-svar valideras per endpoint-schema
// i expectOk — typerna är z.infer-härledda (samma exporterade namn som förr).
// Kräver det koden KONSUMERAR (path/type/sha resp. tree.sha, encoding,
// content); övriga API-fält är optionella — strikt där det räknas, utan att
// vara skört mot API-tillägg.
const treeEntrySchema = z.object({
  path: z.string(),
  mode: z.string().optional(), // "100644" (file), "100755" (exec), "040000" (tree)
  type: z.enum(["blob", "tree", "commit"]),
  sha: z.string(),
  size: z.number().optional(),
  url: z.string().optional(),
});

const treeDataSchema = z.object({
  sha: z.string(),
  truncated: z.boolean(),
  tree: z.array(treeEntrySchema),
});

const gitActorSchema = z.object({ name: z.string(), email: z.string(), date: z.string() });

const commitDataSchema = z.object({
  sha: z.string(),
  message: z.string().optional(),
  tree: z.object({ sha: z.string() }),
  parents: z.array(z.object({ sha: z.string() })).optional(),
  author: gitActorSchema.optional(),
  committer: gitActorSchema.optional(),
});

const blobDataSchema = z.object({
  sha: z.string().optional(),
  content: z.string(),
  encoding: z.enum(["base64", "utf-8"]),
  size: z.number().optional(),
});

const shaResponseSchema = z.object({ sha: z.string() });
const branchHeadSchema = z.object({ object: z.object({ sha: z.string() }) });
const errorBodySchema = z.object({ message: z.string().optional() }).passthrough();

export type TreeData = z.infer<typeof treeDataSchema>;
export type CommitData = z.infer<typeof commitDataSchema>;
export type BlobData = z.infer<typeof blobDataSchema>;

async function apiFetch(path: string, init: RequestInit, opts: ApiOpts): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    ...omitUndefined({ signal: opts.signal }),
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${opts.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  return res;
}

async function expectOk<S extends z.ZodType>(res: Response, label: string, schema: S): Promise<z.infer<S>> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let msg = body;
    try {
      const parsed = errorBodySchema.safeParse(JSON.parse(body));
      if (parsed.success && parsed.data.message) msg = parsed.data.message;
    } catch { /* ignorera — rå body */ }
    throw new Error(`${label}: ${res.status} ${res.statusText} ${msg ? "— " + msg : ""}`);
  }
  return schema.parse(await res.json()) as z.infer<S>;
}

/** GET /repos/{o}/{r}/git/refs/heads/{branch} */
export async function getBranchHead(repo: RepoLocator, branch: string, opts: ApiOpts): Promise<string> {
  const res = await apiFetch(`/repos/${repo.owner}/${repo.repo}/git/ref/heads/${encodeURIComponent(branch)}`, {}, opts);
  const data = await expectOk(res, "getBranchHead", branchHeadSchema);
  return data.object.sha;
}

/** GET /repos/{o}/{r}/git/commits/{sha} */
export async function getCommit(repo: RepoLocator, sha: string, opts: ApiOpts): Promise<CommitData> {
  const res = await apiFetch(`/repos/${repo.owner}/${repo.repo}/git/commits/${sha}`, {}, opts);
  return expectOk(res, "getCommit", commitDataSchema);
}

/** GET /repos/{o}/{r}/git/trees/{sha}?recursive=1 */
export async function getTreeRecursive(repo: RepoLocator, treeSha: string, opts: ApiOpts): Promise<TreeData> {
  const res = await apiFetch(`/repos/${repo.owner}/${repo.repo}/git/trees/${treeSha}?recursive=1`, {}, opts);
  return expectOk(res, "getTreeRecursive", treeDataSchema);
}

/** GET /repos/{o}/{r}/git/blobs/{sha} */
export async function getBlob(repo: RepoLocator, sha: string, opts: ApiOpts): Promise<BlobData> {
  const res = await apiFetch(`/repos/${repo.owner}/${repo.repo}/git/blobs/${sha}`, {}, opts);
  return expectOk(res, "getBlob", blobDataSchema);
}

/** POST /repos/{o}/{r}/git/blobs */
export async function createBlob(repo: RepoLocator, content: Uint8Array, opts: ApiOpts): Promise<string> {
  const res = await apiFetch(
    `/repos/${repo.owner}/${repo.repo}/git/blobs`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: bytesToBase64(content),
        encoding: "base64",
      }),
    },
    opts,
  );
  const data = await expectOk(res, "createBlob", shaResponseSchema);
  return data.sha;
}

/** POST /repos/{o}/{r}/git/trees */
export async function createTree(
  repo: RepoLocator,
  baseTreeSha: string | null,
  entries: Array<{ path: string; mode: string; type: "blob"; sha: string | null }>,
  opts: ApiOpts,
): Promise<string> {
  const body: Record<string, unknown> = { tree: entries };
  if (baseTreeSha) body.base_tree = baseTreeSha;
  const res = await apiFetch(
    `/repos/${repo.owner}/${repo.repo}/git/trees`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    opts,
  );
  const data = await expectOk(res, "createTree", shaResponseSchema);
  return data.sha;
}

/** POST /repos/{o}/{r}/git/commits — kan inkludera SSH-signatur. */
export async function createCommit(
  repo: RepoLocator,
  args: {
    message: string;
    tree: string;
    parents: string[];
    /** SSH-signature i armored format. Om angiven får GH-commit `Verified`-badge. */
    signature?: string;
    author?: { name: string; email: string };
  },
  opts: ApiOpts,
): Promise<string> {
  const res = await apiFetch(
    `/repos/${repo.owner}/${repo.repo}/git/commits`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    },
    opts,
  );
  const data = await expectOk(res, "createCommit", shaResponseSchema);
  return data.sha;
}

/** PATCH /repos/{o}/{r}/git/refs/heads/{branch} — push. */
export async function updateRef(
  repo: RepoLocator,
  branch: string,
  sha: string,
  opts: ApiOpts & { force?: boolean },
): Promise<void> {
  const res = await apiFetch(
    `/repos/${repo.owner}/${repo.repo}/git/refs/heads/${encodeURIComponent(branch)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha, force: opts.force ?? false }),
    },
    opts,
  );
  await expectOk(res, "updateRef", z.record(z.string(), z.unknown()));
}

// ─── Hjälpfunktioner ─────────────────────────────────────────────────

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  // GH returnerar base64 med radbrytningar
  const clean = b64.replace(/\s/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Parsa `user/repo` eller `https://github.com/user/repo[.git]` till
 * `{owner, repo}`. Returnerar null om input inte är GitHub-format.
 */
export function parseRepoLocator(input: string): RepoLocator | null {
  const trimmed = input.trim().replace(/\.git$/, "");
  // Försök matcha github.com-prefixet först
  const ghMatch = trimmed.match(/github\.com[/:]([^/]+)\/([^/\s]+)$/);
  if (ghMatch) return { owner: ghMatch[1]!, repo: ghMatch[2]! };
  // Annars: kortform "owner/repo" utan host
  const shortMatch = trimmed.match(/^([^/\s:]+)\/([^/\s]+)$/);
  if (shortMatch) return { owner: shortMatch[1]!, repo: shortMatch[2]! };
  return null;
}
