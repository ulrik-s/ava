/**
 * `GitContentStore` (#518) — git-backad `IContentStore` för server-first.
 *
 * `AVA_CONTENT_DIR` är ett git-repo: varje skrivning committas, så en annan
 * server kan `git pull` dokument-byte:sen som backup, och git-historiken ger
 * versionering. Innehållet lagras platt (content-adresserat av anroparen —
 * `storagePath` = `documents/content/<sha256>`); **mappstrukturen bor i
 * Postgres** (`document_folders`), inte i repo-trädet. Postgres backas upp
 * separat (pg_dump).
 *
 * Demo/web rör aldrig detta — de använder `noopContentStore`.
 *
 * `storagePath` saneras mot path-traversal (måste lösa sig UNDER rot-dir:t).
 *
 * **Samtidighet (#1378):** git har ETT index per repo. Två samtidiga `git add`/
 * `commit` krockar på `.git/index.lock` ("File exists" → 500). Server-first är
 * en enda process per `AVA_CONTENT_DIR`, så skrivningarna serialiseras per repo
 * med en async-mutex i processen (`repoWriteLock`, delad av alla instanser).
 * Ett kvarlämnat lås efter en krasch och ett lås från en annan git-process
 * hanteras i `git-index-lock.ts`.
 */

import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { KeyedMutex } from "../concurrency/mutex";
import type { IContentStore } from "../ports";
import {
  type IndexLockRetryPolicy,
  removeStaleIndexLock,
  withIndexLockRetry,
} from "./git-index-lock";

const exec = promisify(execFile);

/** Committar `relPath` i `repoDir` (init:ar repot vid behov). Injicerbar för test. */
export type GitCommitter = (repoDir: string, relPath: string, message: string) => Promise<void>;

async function hasGitDir(dir: string): Promise<boolean> {
  try { await access(resolve(dir, ".git")); return true; } catch { return false; }
}

/**
 * Standard-committer: shellar ut till `git` (samma binär som driver
 * git-http-backend i web-containern). Init:ar repot om det saknas och
 * hoppar commit om inget stagats (identiskt content-adresserat innehåll).
 */
export const gitCommit: GitCommitter = async (repoDir, relPath, message) => {
  if (!(await hasGitDir(repoDir))) {
    await exec("git", ["-C", repoDir, "init", "-q"]);
  }
  await exec("git", ["-C", repoDir, "add", "--", relPath]);
  try {
    // exit 0 = inget stagat → identiskt innehåll, hoppa commit.
    await exec("git", ["-C", repoDir, "diff", "--cached", "--quiet"]);
    return;
  } catch {
    // exit≠0 = stagade ändringar finns → committa nedan.
  }
  await exec("git", [
    "-C", repoDir,
    "-c", "user.name=AVA", "-c", "user.email=ava@localhost",
    "commit", "-q", "-m", message,
  ]);
};

/**
 * Skrivlås per content-repo (nyckel = absolut repo-sökväg). Modulnivå, så att
 * två `GitContentStore` mot samma katalog också serialiseras mot varandra.
 */
const repoWriteLock = new KeyedMutex<string>();

export class GitContentStore implements IContentStore {
  private readonly root: string;

  constructor(
    rootDir: string,
    private readonly committer: GitCommitter = gitCommit,
    private readonly lockRetry?: IndexLockRetryPolicy,
  ) {
    this.root = resolve(rootDir);
  }

  /** Lös + validera att `storagePath` hamnar under rot-dir:t (anti-traversal). */
  private safeResolve(storagePath: string): string | null {
    const abs = resolve(this.root, storagePath);
    const rel = relative(this.root, abs);
    if (rel.startsWith("..") || resolve(this.root, rel) !== abs) return null;
    return abs;
  }

  async write(storagePath: string, bytes: Uint8Array): Promise<void> {
    const abs = this.safeResolve(storagePath);
    if (!abs) throw new Error(`GitContentStore: ogiltig storagePath "${storagePath}"`);
    // Filen skrivs också under låset: två samtidiga skrivningar av SAMMA
    // content-adresserade sökväg får inte låta `git add` stagea en halvskriven fil.
    await repoWriteLock.runExclusive(this.root, async () => {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, bytes);
      // Vi håller repo-mutexen → inget lås kan vara vårt eget; ett gammalt är kvarlämnat.
      await removeStaleIndexLock(this.root);
      await withIndexLockRetry(
        () => this.committer(this.root, relative(this.root, abs), `content: ${storagePath}`),
        this.lockRetry,
      );
    });
  }

  async read(storagePath: string): Promise<Uint8Array | null> {
    const abs = this.safeResolve(storagePath);
    if (!abs) return null;
    try {
      return new Uint8Array(await readFile(abs));
    } catch {
      return null; // saknas / oläsbar → null (anroparen hanterar)
    }
  }

  async exists(storagePath: string): Promise<boolean> {
    const abs = this.safeResolve(storagePath);
    if (!abs) return false;
    try {
      await access(abs);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Läs content-dir:t ur env. `AVA_CONTENT_DIR` pekar på git-repot där
 * server-first lagrar dokument-bytes. Saknas den → `undefined` (anroparen
 * faller tillbaka till no-op-store, dvs ingen server-side-lagring).
 */
export function loadContentDirFromEnv(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const dir = env.AVA_CONTENT_DIR?.trim();
  return dir ? resolve(dir) : undefined;
}

/** Bygg server-first content-store: `GitContentStore` om dir satt, annars null. */
export function makeContentStore(contentDir: string | undefined): GitContentStore | null {
  return contentDir ? new GitContentStore(contentDir) : null;
}
