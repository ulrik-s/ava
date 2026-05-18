/**
 * `NodeGitOps` — `IGitOps`-implementation via subprocess till system-`git`.
 *
 * Vald över `isomorphic-git` för Fas 3 (Tauri/Node-runtime) eftersom:
 *   - System-`git` hanterar SSH-auth via ssh-agent out-of-the-box
 *   - File://-remotes funkar för tester utan att spinna upp HTTP-server
 *   - HTTPS-creds (credential helper) tas hand om automatiskt
 *   - Push-CAS-semantik matchar precis det spike-resultatet validerade
 *
 * För **pure-web-varianten** (Fas 4) får vi byta ut detta mot
 * `IsomorphicGitOps` som använder `isomorphic-git` direkt — paketet är
 * redan installerat för det bruket.
 *
 * Designval (Single responsibility):
 *   - Den här klassen gör BARA git-operationer. Inga side-effects mot
 *     events, claims eller projektioner.
 *
 * Designval (Liskov):
 *   - Identiskt kontrakt som `InMemoryGitOps`. LocalGitStore och dess
 *     komponenter kan inte se skillnad.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitCommit, IGitOps, PushResult } from "./git-ops";

const execFileP = promisify(execFile);

const FORMAT = "%H|%s|%an|%aI"; // hash|subject|author-name|author-iso-date

export class NodeGitOps implements IGitOps {
  constructor(
    private readonly dir: string,
    private readonly authorName: string,
    private readonly authorEmail: string,
    private readonly remote: string = "origin",
    private readonly branch: string = "main",
  ) {}

  async fetch(): Promise<void> {
    await this.run(["fetch", this.remote, this.branch]);
  }

  async remoteHead(): Promise<GitCommit> {
    return this.headOf(`${this.remote}/${this.branch}`);
  }

  async localHead(): Promise<GitCommit> {
    return this.headOf("HEAD");
  }

  async pendingCommitsAhead(): Promise<GitCommit[]> {
    // Lista commits i HEAD som inte finns i origin/main, äldsta först
    const { stdout } = await this.run([
      "log",
      `${this.remote}/${this.branch}..HEAD`,
      "--reverse",
      `--format=${FORMAT}`,
    ]);
    return this.parseLog(stdout);
  }

  async commit(message: string): Promise<GitCommit> {
    await this.run(["add", "-A"]);
    await this.run([
      "-c", `user.name=${this.authorName}`,
      "-c", `user.email=${this.authorEmail}`,
      "commit",
      "--allow-empty",
      "-m", message,
    ]);
    return this.localHead();
  }

  async push(): Promise<PushResult> {
    try {
      await this.run(["push", this.remote, this.branch]);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/non-fast-forward|rejected|fetch first/i.test(msg)) {
        return { ok: false, reason: "NonFastForward" };
      }
      if (/network|could not resolve|connection|timeout/i.test(msg)) {
        return { ok: false, reason: "NetworkError" };
      }
      return { ok: false, reason: "Unknown" };
    }
  }

  async resetHardToRemote(): Promise<void> {
    await this.run(["fetch", this.remote, this.branch]);
    await this.run(["reset", "--hard", `${this.remote}/${this.branch}`]);
  }

  // ── private ───────────────────────────────────────────────────

  private async run(args: string[]): Promise<{ stdout: string; stderr: string }> {
    const { stdout, stderr } = await execFileP("git", args, { cwd: this.dir });
    return { stdout, stderr };
  }

  private async headOf(ref: string): Promise<GitCommit> {
    const { stdout } = await this.run(["log", "-1", ref, `--format=${FORMAT}`]);
    const commits = this.parseLog(stdout);
    if (!commits.length) throw new Error(`Inget HEAD för ${ref}`);
    return commits[0];
  }

  private parseLog(stdout: string): GitCommit[] {
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [hash, message, author, ts] = line.split("|");
        return { hash, message, author, ts };
      });
  }
}
