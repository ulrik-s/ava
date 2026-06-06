"use client";

/**
 * Tunna wrappers runt GitHub:s git-database REST-endpoints. ALLA går
 * mot api.github.com som har CORS `*` — ingen proxy behövs.
 *
 * Rate-limit: 5000 req/timme med auth (15000 för GitHub Enterprise).
 * Vi använder så få calls som möjligt: tree?recursive=1 i ett anrop,
 * parallella blob-fetches, bara skapade objekt postas.
 */

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

export interface TreeEntry {
  path: string;
  mode: string;       // "100644" (file), "100755" (exec), "040000" (tree)
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
  url?: string;
}

export interface TreeData {
  sha: string;
  truncated: boolean;
  tree: TreeEntry[];
}

export interface CommitData {
  sha: string;
  message: string;
  tree: { sha: string };
  parents: Array<{ sha: string }>;
  author: { name: string; email: string; date: string };
  committer: { name: string; email: string; date: string };
}

export interface BlobData {
  sha: string;
  content: string;
  encoding: "base64" | "utf-8";
  size: number;
}

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

async function expectOk<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let msg = body;
    try { msg = (JSON.parse(body) as { message?: string }).message ?? body; } catch { /* ignorera */ }
    throw new Error(`${label}: ${res.status} ${res.statusText} ${msg ? "— " + msg : ""}`);
  }
  return res.json() as Promise<T>;
}

/** GET /repos/{o}/{r}/git/refs/heads/{branch} */
export async function getBranchHead(repo: RepoLocator, branch: string, opts: ApiOpts): Promise<string> {
  const res = await apiFetch(`/repos/${repo.owner}/${repo.repo}/git/ref/heads/${encodeURIComponent(branch)}`, {}, opts);
  const data = await expectOk<{ object: { sha: string } }>(res, "getBranchHead");
  return data.object.sha;
}

/** GET /repos/{o}/{r}/git/commits/{sha} */
export async function getCommit(repo: RepoLocator, sha: string, opts: ApiOpts): Promise<CommitData> {
  const res = await apiFetch(`/repos/${repo.owner}/${repo.repo}/git/commits/${sha}`, {}, opts);
  return expectOk<CommitData>(res, "getCommit");
}

/** GET /repos/{o}/{r}/git/trees/{sha}?recursive=1 */
export async function getTreeRecursive(repo: RepoLocator, treeSha: string, opts: ApiOpts): Promise<TreeData> {
  const res = await apiFetch(`/repos/${repo.owner}/${repo.repo}/git/trees/${treeSha}?recursive=1`, {}, opts);
  return expectOk<TreeData>(res, "getTreeRecursive");
}

/** GET /repos/{o}/{r}/git/blobs/{sha} */
export async function getBlob(repo: RepoLocator, sha: string, opts: ApiOpts): Promise<BlobData> {
  const res = await apiFetch(`/repos/${repo.owner}/${repo.repo}/git/blobs/${sha}`, {}, opts);
  return expectOk<BlobData>(res, "getBlob");
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
  const data = await expectOk<{ sha: string }>(res, "createBlob");
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
  const data = await expectOk<{ sha: string }>(res, "createTree");
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
  const data = await expectOk<{ sha: string }>(res, "createCommit");
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
  await expectOk(res, "updateRef");
}

// ─── Hjälpfunktioner ─────────────────────────────────────────────────

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
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
  if (ghMatch) return { owner: ghMatch[1], repo: ghMatch[2] };
  // Annars: kortform "owner/repo" utan host
  const shortMatch = trimmed.match(/^([^/\s:]+)\/([^/\s]+)$/);
  if (shortMatch) return { owner: shortMatch[1], repo: shortMatch[2] };
  return null;
}
