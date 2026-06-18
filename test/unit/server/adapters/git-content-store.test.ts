/**
 * Tester för `GitContentStore` (#518) — git-backad content-store för
 * server-first. Enhetstester injicerar en stub-committer (snabba, kräver ej
 * git); ett integrationstest kör riktiga `gitCommit` (git finns i CI/dev).
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
