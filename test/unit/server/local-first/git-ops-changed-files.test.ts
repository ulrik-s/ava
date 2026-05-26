/**
 * Tester för `IGitOps.changedFiles`-metoden. Liskov-substituerbarhet:
 * vi kör samma test-svit mot bägge implementationer (InMemory + Node)
 * och de ska bete sig identiskt.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync, spawnSync } from "node:child_process";
import { InMemoryGitOps } from "@/lib/server/local-first/in-memory-git-ops";
import { InMemoryFileSystem } from "@/lib/server/local-first/in-memory-fs";
import { NodeGitOps } from "@/lib/server/local-first/node-git-ops";
import type { IGitOps } from "@/lib/server/local-first/git-ops";

function hasGit() { return spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0; }

describe("IGitOps.changedFiles — InMemoryGitOps", () => {
  it("returnerar filer som ändrats mellan två commits", async () => {
    const fs = new InMemoryFileSystem();
    const ops = new InMemoryGitOps("anna", fs);

    await fs.writeFile("a.txt", "första");
    const c1 = await ops.commit("A1");
    await ops.push();

    await fs.writeFile("b.txt", "andra");
    const c2 = await ops.commit("A2");
    await ops.push();

    const changed = await ops.changedFiles(c1.hash, c2.hash);
    expect(changed).toContain("b.txt");
  });

  it("returnerar tom array när inga ändringar mellan commits", async () => {
    const fs = new InMemoryFileSystem();
    const ops = new InMemoryGitOps("anna", fs);
    await fs.writeFile("a.txt", "x");
    const c1 = await ops.commit("c1");
    await ops.push();
    const changed = await ops.changedFiles(c1.hash, c1.hash);
    expect(changed).toEqual([]);
  });
});

const skipIfNoGit = hasGit() ? describe : describe.skip;

skipIfNoGit("IGitOps.changedFiles — NodeGitOps", () => {
  let root: string;
  let bare: string;
  let workDir: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "ava-cf-"));
    bare = join(root, "origin.git");
    workDir = join(root, "anna");
  });

  beforeEach(async () => {
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });
    execSync(`git init --bare --quiet --initial-branch=main "${bare}"`);
    const seed = join(root, "_seed");
    execSync(`git clone --quiet "${bare}" "${seed}"`);
    await writeFile(join(seed, ".gitkeep"), "");
    execSync(`git -C "${seed}" -c user.email=s@x -c user.name=s add -A`);
    execSync(`git -C "${seed}" -c user.email=s@x -c user.name=s commit --quiet -m init`);
    execSync(`git -C "${seed}" push --quiet origin main`);
    await rm(seed, { recursive: true });
    execSync(`git clone --quiet "${bare}" "${workDir}"`);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("listar filer som ändrats mellan två commits", async () => {
    const ops: IGitOps = new NodeGitOps(workDir, "anna", "anna@x");
    await writeFile(join(workDir, "a.txt"), "första");
    const c1 = await ops.commit("A1");
    await writeFile(join(workDir, "b.txt"), "andra");
    await writeFile(join(workDir, "subdir/c.txt"), "tredje").catch(async () => {
      await mkdir(join(workDir, "subdir"), { recursive: true });
      await writeFile(join(workDir, "subdir/c.txt"), "tredje");
    });
    const c2 = await ops.commit("A2");
    const changed = await ops.changedFiles(c1.hash, c2.hash);
    expect(changed).toContain("b.txt");
    expect(changed).toContain("subdir/c.txt");
    expect(changed).not.toContain("a.txt");
  });

  it("returnerar tom array för identiska hashar", async () => {
    const ops: IGitOps = new NodeGitOps(workDir, "anna", "anna@x");
    await writeFile(join(workDir, "a.txt"), "x");
    const c = await ops.commit("c");
    expect(await ops.changedFiles(c.hash, c.hash)).toEqual([]);
  });

  it("inkluderar deleted-filer", async () => {
    const ops: IGitOps = new NodeGitOps(workDir, "anna", "anna@x");
    await writeFile(join(workDir, "doomed.txt"), "snart borta");
    const c1 = await ops.commit("skapa");
    execSync(`rm "${join(workDir, "doomed.txt")}"`);
    const c2 = await ops.commit("radera");
    const changed = await ops.changedFiles(c1.hash, c2.hash);
    expect(changed).toContain("doomed.txt");
  });

  it("tom fromHash → listar alla filer i toHash (ls-tree)", async () => {
    const ops: IGitOps = new NodeGitOps(workDir, "anna", "anna@x");
    await writeFile(join(workDir, "a.txt"), "x");
    await writeFile(join(workDir, "b.txt"), "y");
    const c = await ops.commit("c");
    const all = await ops.changedFiles("", c.hash);
    expect(all).toContain("a.txt");
    expect(all).toContain("b.txt");
  });
});
