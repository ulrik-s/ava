/**
 * `IsomorphicGitOps` — `IGitOps`-implementation via `isomorphic-git`.
 *
 * Används av browser-runtime (Fas 4) och Node-runtimes som inte kan
 * spawn:a subprocess. För Tauri-runtime är `NodeGitOps` snabbare och
 * hanterar SSH-auth — den här klassen finns för web-varianten där
 * subprocess inte är ett alternativ.
 *
 * Designval (Single responsibility):
 *   - Bara git-operationer. Inga side-effects mot fs utöver det git
 *     själv gör (refs, objects, working tree).
 *
 * Designval (Dependency inversion):
 *   - Beror på `IFileSystem`-yta via `MemFs.nodeFs()`-adapter.
 *   - `http`-pluginen injiceras → tester kan mocka, produktion
 *     använder `isomorphic-git/http/web` (browser) eller
 *     `isomorphic-git/http/node` (Node-fallback).
 *
 * Designval (Liskov):
 *   - Identiskt kontrakt som `NodeGitOps` och `InMemoryGitOps`.
 *     LocalGitStore/SyncLoop kan inte se skillnad.
 */

import * as git from "isomorphic-git";
import type { GitCommit, IGitOps, PushResult } from "./git-ops";
import type { MemFs } from "./mem-fs";

export interface IsomorphicGitOpsDeps {
  /** MemFs (eller annan IFileSystem som även exponerar `nodeFs()`). */
  fs: MemFs;
  /** Working-directory inom fs:en. Typisk "/" eller "/repo". */
  dir: string;
  authorName: string;
  authorEmail: string;
  /** Default "main". */
  branch?: string;
  /** Default "origin". */
  remoteName?: string;
  /** HTTPS-url till remote. Krävs för fetch/push/clone. */
  remoteUrl?: string;
  /** Auth-token för HTTPS (Bearer eller basic). Krävs för push i de flesta fall. */
  token?: string;
  /** isomorphic-git http-plugin. Browsers: `isomorphic-git/http/web`. */
  http?: { request: (opts: unknown) => Promise<unknown> };
}

export class IsomorphicGitOps implements IGitOps {
  private readonly fs: MemFs;
  private readonly dir: string;
  private readonly branch: string;
  private readonly remoteName: string;

  constructor(private deps: IsomorphicGitOpsDeps) {
    this.fs = deps.fs;
    this.dir = deps.dir;
    this.branch = deps.branch ?? "main";
    this.remoteName = deps.remoteName ?? "origin";
  }

  async fetch(): Promise<void> {
    this.requireRemote();
    await git.fetch({
      fs: this.fs.nodeFs(),
      http: this.deps.http as never,
      dir: this.dir,
      remote: this.remoteName,
      ref: this.branch,
      url: this.deps.remoteUrl,
      ...(this.deps.token ? { onAuth: () => ({ username: "token", password: this.deps.token! }) } : {}),
    });
  }

  async remoteHead(): Promise<GitCommit> {
    return this.headOf(`refs/remotes/${this.remoteName}/${this.branch}`);
  }

  async localHead(): Promise<GitCommit> {
    return this.headOf("HEAD");
  }

  async pendingCommitsAhead(): Promise<GitCommit[]> {
    const localHead = await git.resolveRef({ fs: this.fs.nodeFs(), dir: this.dir, ref: "HEAD" })
      .catch(() => null);
    if (!localHead) return [];
    const remoteHead = await git.resolveRef({
      fs: this.fs.nodeFs(), dir: this.dir, ref: `refs/remotes/${this.remoteName}/${this.branch}`,
    }).catch(() => null);
    if (!remoteHead) {
      // Ingen remote känd → alla lokala commits är "ahead"
      const log = await git.log({ fs: this.fs.nodeFs(), dir: this.dir, ref: "HEAD" });
      return log.map((l) => this.toCommit(l));
    }
    const log = await git.log({ fs: this.fs.nodeFs(), dir: this.dir, ref: "HEAD" });
    const out: GitCommit[] = [];
    for (const entry of log) {
      if (entry.oid === remoteHead) break;
      out.push(this.toCommit(entry));
    }
    return out.reverse();
  }

  async commit(message: string): Promise<GitCommit> {
    // Stage alla ändringar
    const status = await git.statusMatrix({ fs: this.fs.nodeFs(), dir: this.dir });
    await Promise.all(status.map(async ([filepath, , workdir]) => {
      if (workdir === 0) {
        await git.remove({ fs: this.fs.nodeFs(), dir: this.dir, filepath });
      } else {
        await git.add({ fs: this.fs.nodeFs(), dir: this.dir, filepath });
      }
    }));

    const oid = await git.commit({
      fs: this.fs.nodeFs(),
      dir: this.dir,
      message,
      author: { name: this.deps.authorName, email: this.deps.authorEmail },
    });
    const log = await git.log({ fs: this.fs.nodeFs(), dir: this.dir, ref: oid, depth: 1 });
    return this.toCommit(log[0]);
  }

  // eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Async method 'push' has a complexity of 9. Maximum allowed is 8.)
  async push(): Promise<PushResult> {
    if (!this.deps.remoteUrl || !this.deps.http) {
      return { ok: false, reason: "Unknown" };
    }
    try {
      const result = await git.push({
        fs: this.fs.nodeFs(),
        http: this.deps.http as never,
        dir: this.dir,
        remote: this.remoteName,
        ref: this.branch,
        url: this.deps.remoteUrl,
        ...(this.deps.token ? { onAuth: () => ({ username: "token", password: this.deps.token! }) } : {}),
      });
      if (result.ok) return { ok: true };
      return { ok: false, reason: "NonFastForward" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/non-fast-forward|rejected|push not fast-forward/i.test(msg)) {
        return { ok: false, reason: "NonFastForward" };
      }
      if (/network|fetch|timeout|connection/i.test(msg)) {
        return { ok: false, reason: "NetworkError" };
      }
      return { ok: false, reason: "Unknown" };
    }
  }

  async resetHardToRemote(): Promise<void> {
    await this.fetch();
    const ref = `refs/remotes/${this.remoteName}/${this.branch}`;
    const oid = await git.resolveRef({ fs: this.fs.nodeFs(), dir: this.dir, ref });
    await git.checkout({
      fs: this.fs.nodeFs(),
      dir: this.dir,
      ref: oid,
      force: true,
    });
  }

  async changedFiles(fromHash: string, toHash: string): Promise<string[]> {
    if (fromHash === toHash) return [];
    if (!fromHash) {
      // Lista alla filer i `toHash` via walk
      const files = await git.listFiles({ fs: this.fs.nodeFs(), dir: this.dir, ref: toHash });
      return files;
    }
    // Använd walk för att hitta diff mellan två trees.
    const A = git.TREE({ ref: fromHash });
    const B = git.TREE({ ref: toHash });
    const changed = await git.walk({
      fs: this.fs.nodeFs(),
      dir: this.dir,
      trees: [A, B],
      map: async (filepath, [a, b]) => {
        if (filepath === ".") return;
        // Olika oid eller existens → ändrad
        const aOid = a ? await a.oid() : null;
        const bOid = b ? await b.oid() : null;
        if (aOid !== bOid) return filepath;
        return undefined;
      },
    });
    return (changed as string[]).filter(Boolean).sort();
  }

  // ── interna ──────────────────────────────────────────────────

  private requireRemote(): void {
    if (!this.deps.remoteUrl || !this.deps.http) {
      throw new Error("IsomorphicGitOps: remoteUrl + http krävs för remote-operationer");
    }
  }

  private async headOf(ref: string): Promise<GitCommit> {
    const oid = await git.resolveRef({ fs: this.fs.nodeFs(), dir: this.dir, ref });
    const log = await git.log({ fs: this.fs.nodeFs(), dir: this.dir, ref: oid, depth: 1 });
    return this.toCommit(log[0]);
  }

  private toCommit(entry: { oid: string; commit: { message: string; author: { name: string; timestamp: number } } }): GitCommit {
    return {
      hash: entry.oid,
      message: entry.commit.message,
      author: entry.commit.author.name,
      ts: new Date(entry.commit.author.timestamp * 1000).toISOString(),
    };
  }
}
