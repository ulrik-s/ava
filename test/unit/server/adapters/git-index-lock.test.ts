/**
 * Tester för git-indexlåset i content-repot (#1378): ett kvarlämnat lås tas
 * bort bara när det är gammalt, och ett upptaget lås väntas ut med begränsad
 * backoff.
 */

import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest-compat";
import {
  type IndexLockRetryPolicy,
  removeStaleIndexLock,
  withIndexLockRetry,
} from "@/lib/server/adapters/git-index-lock";

const LOCK_ERROR = new Error(
  "Command failed: git add -- x\nfatal: Unable to create '/data/content/.git/index.lock': File exists.",
);

function recordingPolicy(attempts: number): { policy: IndexLockRetryPolicy; delays: number[] } {
  const delays: number[] = [];
  return { delays, policy: { attempts, baseDelayMs: 10, sleep: async (ms) => { delays.push(ms); } } };
}

describe("removeStaleIndexLock", () => {
  let dir: string;
  let lockPath: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ava-index-lock-"));
    await mkdir(join(dir, ".git"));
    lockPath = join(dir, ".git", "index.lock");
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("inget lås → false", async () => {
    expect(await removeStaleIndexLock(dir)).toBe(false);
  });

  it("färskt lås (en annan git-process) lämnas kvar", async () => {
    await writeFile(lockPath, "");
    expect(await removeStaleIndexLock(dir)).toBe(false);
    expect((await stat(lockPath)).isFile()).toBe(true);
  });

  it("lås äldre än gränsen (kvarlämnat efter krasch) tas bort", async () => {
    await writeFile(lockPath, "");
    const { mtimeMs } = await stat(lockPath);
    expect(await removeStaleIndexLock(dir, mtimeMs + 61_000)).toBe(true);
    await expect(stat(lockPath)).rejects.toThrow();
  });

  it("egen gräns: precis under gränsen lämnas låset kvar", async () => {
    await writeFile(lockPath, "");
    const { mtimeMs } = await stat(lockPath);
    expect(await removeStaleIndexLock(dir, mtimeMs + 999, 1_000)).toBe(false);
    expect(await removeStaleIndexLock(dir, mtimeMs + 1_000, 1_000)).toBe(true);
  });
});

describe("withIndexLockRetry", () => {
  it("lyckas direkt → inget nytt försök", async () => {
    const { policy, delays } = recordingPolicy(3);
    expect(await withIndexLockRetry(async () => "ok", policy)).toBe("ok");
    expect(delays).toEqual([]);
  });

  it("upptaget lås → nya försök med dubblad väntan tills det lyckas", async () => {
    const { policy, delays } = recordingPolicy(5);
    let calls = 0;
    const result = await withIndexLockRetry(async () => {
      calls++;
      if (calls < 3) throw LOCK_ERROR;
      return "committad";
    }, policy);
    expect(result).toBe("committad");
    expect(delays).toEqual([10, 20]);
  });

  it("låset släpper aldrig → låsfelet kastas efter sista försöket", async () => {
    const { policy, delays } = recordingPolicy(3);
    await expect(withIndexLockRetry(async () => { throw LOCK_ERROR; }, policy)).rejects.toBe(LOCK_ERROR);
    expect(delays).toEqual([10, 20]);
  });

  it("andra fel (och icke-Error) kastas direkt utan nya försök", async () => {
    const { policy, delays } = recordingPolicy(3);
    await expect(withIndexLockRetry(async () => { throw new Error("disk full"); }, policy)).rejects.toThrow("disk full");
    await expect(withIndexLockRetry(async () => { throw "index.lock"; }, policy)).rejects.toBe("index.lock");
    expect(delays).toEqual([]);
  });

  it("default-policyn väntar på riktigt och ger upp efter sina försök", async () => {
    let calls = 0;
    await expect(withIndexLockRetry(async () => { calls++; throw LOCK_ERROR; })).rejects.toBe(LOCK_ERROR);
    expect(calls).toBe(6);
  });
});
