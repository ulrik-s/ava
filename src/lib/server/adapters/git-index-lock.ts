/**
 * Git-indexets lås (`.git/index.lock`) för content-repot (#1378).
 *
 * `GitContentStore` serialiserar sina egna skrivningar per repo i processen
 * (server-first är EN process per `AVA_CONTENT_DIR`), så den krockar aldrig
 * med sig själv. Två saker kan ändå lämna ett lås i vägen:
 *
 * 1. **Ett kvarlämnat lås efter en krasch** (processen dog mitt i `git add`/
 *    `commit`). Git städar inte själv, så varje senare skrivning skulle falla
 *    för alltid. `removeStaleIndexLock` tar bort låset — men BARA när det är
 *    äldre än `staleMs` OCH anroparen håller repo-mutexen (ingen skrivare i
 *    processen kan då äga det).
 * 2. **En annan git-process** (t.ex. en admin som kör `git gc` för hand). Ett
 *    färskt lås tas aldrig bort; i stället görs ett begränsat antal nya försök
 *    med exponentiell backoff (`withIndexLockRetry`).
 */

import { rm, stat } from "node:fs/promises";
import { resolve } from "node:path";

/** Ett lås äldre än så här räknas som kvarlämnat efter en krasch. */
const STALE_INDEX_LOCK_MS = 60_000;

/** Sökvägen till git-indexets lås i `repoDir`. */
function indexLockPath(repoDir: string): string {
  return resolve(repoDir, ".git", "index.lock");
}

/**
 * Tar bort `.git/index.lock` om det är äldre än `staleMs`. Returnerar `true`
 * om ett lås togs bort. Får BARA anropas av den som håller repo-mutexen.
 */
export async function removeStaleIndexLock(
  repoDir: string,
  now: number = Date.now(),
  staleMs: number = STALE_INDEX_LOCK_MS,
): Promise<boolean> {
  const lockPath = indexLockPath(repoDir);
  let mtimeMs: number;
  try {
    ({ mtimeMs } = await stat(lockPath));
  } catch {
    return false; // inget lås
  }
  if (now - mtimeMs < staleMs) return false;
  await rm(lockPath, { force: true });
  return true;
}

/** `true` om felet är git:s "Unable to create '…/index.lock': File exists". */
function isIndexLockError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("index.lock");
}

/** Hur ofta och hur länge ett upptaget indexlås väntas ut. */
export interface IndexLockRetryPolicy {
  /** Totalt antal försök (≥ 1). */
  readonly attempts: number;
  /** Väntan före andra försöket; dubblas för varje nytt försök. */
  readonly baseDelayMs: number;
  /** Injicerbar för test. */
  readonly sleep: (ms: number) => Promise<void>;
}

/** Default: 6 försök, 25 ms → 400 ms (≈ 0,8 s totalt) innan felet släpps igenom. */
const DEFAULT_INDEX_LOCK_RETRY: IndexLockRetryPolicy = {
  attempts: 6,
  baseDelayMs: 25,
  sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
};

/**
 * Kör `fn`; faller den på ett upptaget indexlås görs nya försök enligt
 * `policy`. Andra fel, och låsfelet efter sista försöket, kastas vidare.
 */
export async function withIndexLockRetry<T>(
  fn: () => Promise<T>,
  policy: IndexLockRetryPolicy = DEFAULT_INDEX_LOCK_RETRY,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isIndexLockError(err) || attempt >= policy.attempts) throw err;
      await policy.sleep(policy.baseDelayMs * 2 ** (attempt - 1));
    }
  }
}
