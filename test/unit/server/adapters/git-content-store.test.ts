/**
 * Tester för `GitContentStore` (#518) — git-backad content-store för
 * server-first. Enhetstester injicerar en stub-committer (snabba, kräver ej
 * git); ett integrationstest kör riktiga `gitCommit` (git finns i CI/dev).
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest-compat";
import {
  GitContentStore,
  gitCommit,
  loadContentDirFromEnv,
  makeContentStore,
} from "@/lib/server/adapters/git-content-store";

const exec = promisify(execFile);

describe("GitContentStore (stub committer)", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "ava-git-content-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("write skriver fil + committar; read returnerar samma bytes", async () => {
    const committer = vi.fn(async () => {});
    const store = new GitContentStore(dir, committer);
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await store.write("documents/content/abc123", bytes);

    expect(committer).toHaveBeenCalledTimes(1);
    const [repoDir, relPath, message] = committer.mock.calls[0]!;
    expect(repoDir).toBe(dir);
    expect(relPath).toBe("documents/content/abc123");
    expect(message).toContain("documents/content/abc123");

    const read = await store.read("documents/content/abc123");
    expect(Array.from(read!)).toEqual([1, 2, 3, 4]);
  });

  it("read av saknad sökväg → null", async () => {
    const store = new GitContentStore(dir, vi.fn(async () => {}));
    expect(await store.read("documents/content/saknas")).toBeNull();
  });

  it("anti-traversal: write utanför roten kastar + committar inte", async () => {
    const committer = vi.fn(async () => {});
    const store = new GitContentStore(dir, committer);
    await expect(store.write("../escape", new Uint8Array([1]))).rejects.toThrow(/ogiltig storagePath/);
    expect(committer).not.toHaveBeenCalled();
  });

  it("anti-traversal: read utanför roten → null", async () => {
    const store = new GitContentStore(dir, vi.fn(async () => {}));
    expect(await store.read("../../etc/passwd")).toBeNull();
  });
});

describe("gitCommit (riktig git)", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "ava-git-real-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("init:ar repot + committar bytes; git pull-bar historik", async () => {
    const store = new GitContentStore(dir); // riktig gitCommit
    await store.write("documents/content/h1", new Uint8Array([9, 9, 9]));

    // En commit ska finnas, och fil-bytes ska vara läsbara.
    const { stdout } = await exec("git", ["-C", dir, "log", "--oneline"]);
    expect(stdout.trim().split("\n").length).toBe(1);
    expect(Array.from(await readFile(join(dir, "documents/content/h1")))).toEqual([9, 9, 9]);

    // Identiskt content-adresserat innehåll → ingen ny commit (inget stagat).
    await store.write("documents/content/h1", new Uint8Array([9, 9, 9]));
    const after = await exec("git", ["-C", dir, "log", "--oneline"]);
    expect(after.stdout.trim().split("\n").length).toBe(1);
  });

  it("samtidiga skrivningar (#1378): alla lyckas, en commit var, inget lås kvar", async () => {
    const store = new GitContentStore(dir);
    const writes = Array.from({ length: 24 }, (_, i) =>
      store.write(`documents/content/c${i}`, new Uint8Array([i, i + 1, i + 2])));
    // Samma content-adresserade sökväg från flera uppladdningar samtidigt.
    const same = Array.from({ length: 4 }, () =>
      store.write("documents/content/same", new Uint8Array([7, 7, 7])));
    // En andra instans mot samma katalog delar låset.
    const other = new GitContentStore(dir).write("documents/content/other", new Uint8Array([5]));
    await Promise.all([...writes, ...same, other]);

    const { stdout } = await exec("git", ["-C", dir, "log", "--oneline"]);
    expect(stdout.trim().split("\n").length).toBe(24 + 1 + 1);
    const status = await exec("git", ["-C", dir, "status", "--porcelain"]);
    expect(status.stdout).toBe("");
    await expect(stat(join(dir, ".git", "index.lock"))).rejects.toThrow();
    expect(Array.from(await readFile(join(dir, "documents/content/same")))).toEqual([7, 7, 7]);
  });

  it("kvarlämnat lås efter krasch tas bort och skrivningen lyckas", async () => {
    const store = new GitContentStore(dir);
    await store.write("documents/content/first", new Uint8Array([1]));
    const lockPath = join(dir, ".git", "index.lock");
    await writeFile(lockPath, "");
    const old = new Date(Date.now() - 10 * 60_000);
    await utimes(lockPath, old, old);

    await store.write("documents/content/second", new Uint8Array([2]));
    const { stdout } = await exec("git", ["-C", dir, "log", "--oneline"]);
    expect(stdout.trim().split("\n").length).toBe(2);
    await expect(stat(lockPath)).rejects.toThrow();
  });

  it("färskt lås från en annan git-process: väntas ut, men tas aldrig bort", async () => {
    const lockPath = join(dir, ".git", "index.lock");
    const fastPolicy = { attempts: 3, baseDelayMs: 1, sleep: async () => {} };
    const store = new GitContentStore(dir, undefined, fastPolicy);
    await store.write("documents/content/first", new Uint8Array([1]));
    await writeFile(lockPath, "");

    await expect(store.write("documents/content/blocked", new Uint8Array([2]))).rejects.toThrow(/index\.lock/);
    expect((await stat(lockPath)).isFile()).toBe(true);

    // Den andra processen blir klar under väntan → nästa försök lyckas.
    const releasing = { attempts: 3, baseDelayMs: 1, sleep: async () => { await rm(lockPath, { force: true }); } };
    await new GitContentStore(dir, undefined, releasing).write("documents/content/blocked", new Uint8Array([2]));
    const { stdout } = await exec("git", ["-C", dir, "log", "--oneline"]);
    expect(stdout.trim().split("\n").length).toBe(2);
  });

  it("ett fel i en skrivning släpper låset för nästa", async () => {
    let calls = 0;
    const flaky = async (): Promise<void> => {
      calls++;
      if (calls === 1) throw new Error("disk full");
    };
    const store = new GitContentStore(dir, flaky);
    const results = await Promise.allSettled([
      store.write("documents/content/a", new Uint8Array([1])),
      store.write("documents/content/b", new Uint8Array([2])),
    ]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "fulfilled"]);
  });

  it("gitCommit exporteras som default-committer", () => {
    expect(typeof gitCommit).toBe("function");
  });
});

describe("loadContentDirFromEnv", () => {
  it("returnerar absolut sökväg när AVA_CONTENT_DIR satt", () => {
    expect(loadContentDirFromEnv({ AVA_CONTENT_DIR: "/var/ava/content" })).toBe("/var/ava/content");
  });
  it("undefined när env saknas/tom", () => {
    expect(loadContentDirFromEnv({})).toBeUndefined();
    expect(loadContentDirFromEnv({ AVA_CONTENT_DIR: "  " })).toBeUndefined();
  });
});

describe("makeContentStore", () => {
  it("undefined dir → null (ingen server-side-lagring)", () => {
    expect(makeContentStore(undefined)).toBeNull();
  });
  it("dir → GitContentStore-instans", () => {
    expect(makeContentStore("/tmp/ava")).toBeInstanceOf(GitContentStore);
  });
});
