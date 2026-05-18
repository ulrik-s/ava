/**
 * `InMemoryGitOps` — testdouble för `IGitOps`.
 *
 * Simulerar git's compare-and-swap-semantik utan att köra riktig git.
 * Designprincip: spawn:a flera klienter mot samma "remote" (shared
 * mutable state) och verifiera att push-konkurrens hanteras korrekt.
 *
 * Detta är **inte** en fullständig git-implementation — bara den
 * minimala state-machine vi behöver för att testa LocalGitStore:s
 * sync- och claim-logik.
 */

import type { GitCommit, IGitOps, PushResult } from "./git-ops";
import type { IFileSystem } from "./file-system";
import { InMemoryFileSystem } from "./in-memory-fs";
import { createHash } from "node:crypto";

interface SharedRemote {
  commits: GitCommit[]; // hela linje från initial commit
  /**
   * Working tree per commit-hash. När en klient pushar capture:as
   * dess FS-snapshot här; andra klienter får det vid resetHardToRemote.
   */
  workingTrees: Map<string, Record<string, string>>;
}

export class InMemoryGitOps implements IGitOps {
  private localCommits: GitCommit[] = [];
  private knownRemoteHash: string;
  private commitSeq = 0;

  constructor(
    private readonly author: string,
    private readonly fs: InMemoryFileSystem = new InMemoryFileSystem(),
    private readonly remote: SharedRemote = makeSharedRemote(),
  ) {
    this.knownRemoteHash = remote.commits[remote.commits.length - 1].hash;
    this.localCommits = [...remote.commits];
    // Initial sync: applicera remote head:s working tree (om någon)
    this.applyWorkingTree(this.knownRemoteHash);
  }

  /**
   * Skapa en parallell klient med EGEN fs men SAMMA remote.
   * Används i tester för att simulera konkurrens.
   */
  spawnConcurrentClient(otherAuthor: string, otherFs?: InMemoryFileSystem): InMemoryGitOps {
    return new InMemoryGitOps(otherAuthor, otherFs ?? new InMemoryFileSystem(), this.remote);
  }

  /** Exponera fs:en för callers som behöver skriva direkt. */
  workingTree(): IFileSystem {
    return this.fs;
  }

  async fetch(): Promise<void> {
    this.knownRemoteHash = this.remote.commits[this.remote.commits.length - 1].hash;
  }

  async remoteHead(): Promise<GitCommit> {
    return this.remote.commits[this.remote.commits.length - 1];
  }

  async localHead(): Promise<GitCommit> {
    return this.localCommits[this.localCommits.length - 1];
  }

  async pendingCommitsAhead(): Promise<GitCommit[]> {
    const idx = this.localCommits.findIndex((c) => c.hash === this.knownRemoteHash);
    if (idx === -1) return [...this.localCommits];
    return this.localCommits.slice(idx + 1);
  }

  async commit(message: string): Promise<GitCommit> {
    const c: GitCommit = {
      hash: this.hashFor(message),
      message,
      author: this.author,
      ts: new Date().toISOString(),
    };
    this.localCommits.push(c);
    return c;
  }

  async push(): Promise<PushResult> {
    // CAS: remote-headen vi senast såg måste fortfarande vara den
    // aktuella remote-headen, annars NonFastForward.
    const currentRemoteHead = this.remote.commits[this.remote.commits.length - 1].hash;
    if (currentRemoteHead !== this.knownRemoteHash) {
      return { ok: false, reason: "NonFastForward" };
    }
    const pending = await this.pendingCommitsAhead();
    this.remote.commits.push(...pending);
    // Snapshot:a vår working tree mot senaste commit-hashen så att
    // andra klienter kan pulla in den vid fetch+reset.
    const newHead = this.remote.commits[this.remote.commits.length - 1];
    this.remote.workingTrees.set(newHead.hash, this.fs.snapshot());
    this.knownRemoteHash = newHead.hash;
    return { ok: true };
  }

  async resetHardToRemote(): Promise<void> {
    this.localCommits = [...this.remote.commits];
    this.knownRemoteHash = this.remote.commits[this.remote.commits.length - 1].hash;
    this.applyWorkingTree(this.knownRemoteHash);
  }

  async changedFiles(fromHash: string, toHash: string): Promise<string[]> {
    if (fromHash === toHash) return [];
    const before = this.remote.workingTrees.get(fromHash) ?? {};
    const after = this.remote.workingTrees.get(toHash) ?? {};
    const all = new Set([...Object.keys(before), ...Object.keys(after)]);
    const changed: string[] = [];
    for (const p of all) {
      if (before[p] !== after[p]) changed.push(p);
    }
    return changed.sort();
  }

  // ── private ───────────────────────────────────────────────────

  private applyWorkingTree(hash: string): void {
    const tree = this.remote.workingTrees.get(hash);
    if (!tree) return; // initial commit har ingen tree
    // Rensa nuvarande fs och applicera snapshot
    for (const path of Object.keys(this.fs.snapshot())) {
      void this.fs.deleteFile(path);
    }
    for (const [path, content] of Object.entries(tree)) {
      void this.fs.writeFile(path, content);
    }
  }

  // ── helpers ───────────────────────────────────────────────────

  private hashFor(message: string): string {
    this.commitSeq++;
    return createHash("sha1")
      .update(`${this.author}:${this.commitSeq}:${message}`)
      .digest("hex")
      .slice(0, 12);
  }
}

function makeSharedRemote(): SharedRemote {
  const initial: GitCommit = {
    hash: "0".repeat(12),
    message: "init",
    author: "system",
    ts: new Date(0).toISOString(),
  };
  return { commits: [initial], workingTrees: new Map() };
}
