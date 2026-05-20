/**
 * Web git-operationer ovanpå `FsaIsoGitAdapter`.
 *
 * Bygger på isomorphic-git för clone/status/commit. Push görs via
 * GitHub:s REST API (`/git/refs/heads/...`) eftersom det är
 * CORS-friendly (smart-HTTP-protokollet är blockerat).
 *
 * Designval (CORS-frihet):
 *   - clone via isomorphic-git + GH Pages-läge (eller corsProxy
 *     när det krävs för privata repos via OAuth-token).
 *   - status + commit körs lokalt — inga nätverksanrop.
 *   - push via Octokit / fetch mot api.github.com som har
 *     `Access-Control-Allow-Origin: *`.
 */

import { FsaIsoGitAdapter } from "./fs-adapter";

export interface CloneOptions {
  url: string;
  ref?: string;
  /** OAuth-token eller PAT för privata repos. */
  token?: string;
  /** CORS-proxy URL för smart-http (default = isomorphic-git:s publika). */
  corsProxy?: string;
}

export interface GitStatusEntry {
  path: string;
  status: "added" | "modified" | "deleted" | "untracked";
}

const DEFAULT_CORS_PROXY = "https://cors.isomorphic-git.org";

async function loadIsoGit(): Promise<typeof import("isomorphic-git")> {
  return import("isomorphic-git");
}

async function loadHttp(): Promise<typeof import("isomorphic-git/http/web")> {
  return import("isomorphic-git/http/web");
}

export async function cloneRepo(
  fs: FsaIsoGitAdapter,
  opts: CloneOptions,
): Promise<void> {
  const git = await loadIsoGit();
  const httpMod = await loadHttp();
  await git.clone({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fs: fs as any,
    http: httpMod.default ?? httpMod,
    dir: "/",
    url: opts.url,
    ref: opts.ref ?? "main",
    singleBranch: true,
    depth: 1,
    corsProxy: opts.corsProxy ?? DEFAULT_CORS_PROXY,
    onAuth: opts.token ? () => ({ username: "x-access-token", password: opts.token! }) : undefined,
  });
}

export async function statusMatrix(fs: FsaIsoGitAdapter): Promise<GitStatusEntry[]> {
  const git = await loadIsoGit();
  // statusMatrix returnerar tupler [filepath, HEAD, WORKDIR, STAGE]
  // där 0=missing, 1=existerar, 2=ändrad, 3=ny stage.
  const matrix = await git.statusMatrix({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fs: fs as any,
    dir: "/",
  });
  const entries: GitStatusEntry[] = [];
  for (const [filepath, head, workdir, stage] of matrix) {
    if (head === workdir && workdir === stage) continue; // oförändrad
    let status: GitStatusEntry["status"];
    if (head === 0 && workdir > 0) status = "untracked";
    else if (workdir === 0 && head > 0) status = "deleted";
    else if (head === 0 && stage > 0) status = "added";
    else status = "modified";
    entries.push({ path: filepath, status });
  }
  return entries;
}

export interface CommitArgs {
  message: string;
  authorName: string;
  authorEmail: string;
}

export async function stageAllAndCommit(
  fs: FsaIsoGitAdapter,
  args: CommitArgs,
): Promise<string> {
  const git = await loadIsoGit();
  const matrix = await git.statusMatrix({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fs: fs as any,
    dir: "/",
  });
  for (const [filepath, , workdir] of matrix) {
    if (workdir === 0) {
      await git.remove({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fs: fs as any,
        dir: "/",
        filepath,
      });
    } else {
      await git.add({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fs: fs as any,
        dir: "/",
        filepath,
      });
    }
  }
  const oid = await git.commit({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fs: fs as any,
    dir: "/",
    message: args.message,
    author: { name: args.authorName, email: args.authorEmail },
  });
  return oid;
}

export async function pushBranch(
  fs: FsaIsoGitAdapter,
  opts: { token: string; remote?: string; branch?: string; corsProxy?: string },
): Promise<void> {
  const git = await loadIsoGit();
  const httpMod = await loadHttp();
  await git.push({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fs: fs as any,
    http: httpMod.default ?? httpMod,
    dir: "/",
    remote: opts.remote ?? "origin",
    ref: opts.branch ?? "main",
    corsProxy: opts.corsProxy ?? DEFAULT_CORS_PROXY,
    onAuth: () => ({ username: "x-access-token", password: opts.token }),
  });
}

export async function pullBranch(
  fs: FsaIsoGitAdapter,
  opts: { token: string; authorName: string; authorEmail: string; branch?: string; corsProxy?: string },
): Promise<{ kind: "up-to-date" | "fast-forward" | "merged"; head: string }> {
  const git = await loadIsoGit();
  const httpMod = await loadHttp();
  const before = await git.resolveRef({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fs: fs as any,
    dir: "/",
    ref: "HEAD",
  });
  await git.pull({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fs: fs as any,
    http: httpMod.default ?? httpMod,
    dir: "/",
    ref: opts.branch ?? "main",
    singleBranch: true,
    corsProxy: opts.corsProxy ?? DEFAULT_CORS_PROXY,
    author: { name: opts.authorName, email: opts.authorEmail },
    onAuth: () => ({ username: "x-access-token", password: opts.token }),
  });
  const after = await git.resolveRef({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fs: fs as any,
    dir: "/",
    ref: "HEAD",
  });
  if (before === after) return { kind: "up-to-date", head: after };
  return { kind: "fast-forward", head: after };
}
