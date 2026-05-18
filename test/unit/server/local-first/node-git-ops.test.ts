/**
 * Tester för NodeGitOps — kör mot riktiga git-binärer på systemet.
 * Använder os.tmpdir() med en bare remote + två clones för att verifiera
 * att push-CAS-semantiken fungerar precis som spike-resultatet utlovade.
 *
 * OBS: hoppas över om systemet saknar `git`-binär (osannolikt men möjligt
 * i sandbox).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync, spawnSync } from "node:child_process";
import { NodeGitOps } from "@/server/local-first/node-git-ops";

function hasGit(): boolean {
  return spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0;
}

const skipIfNoGit = hasGit() ? describe : describe.skip;

skipIfNoGit("NodeGitOps", () => {
  let root: string;
  let bare: string;
  let anna: string;
  let bjorn: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "ava-nodegit-"));
    bare = join(root, "origin.git");
    anna = join(root, "anna");
    bjorn = join(root, "bjorn");
  });

  beforeEach(async () => {
    // Reset varje test: tomt bare repo + två fräscha clones
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });
    execSync(`git init --bare --quiet --initial-branch=main "${bare}"`);

    // Seeda första commit via en throwaway clone
    const seed = join(root, "_seed");
    execSync(`git clone --quiet "${bare}" "${seed}"`);
    await writeFile(join(seed, ".gitkeep"), "");
    execSync(`git -C "${seed}" -c user.email=seed@x -c user.name=seed add -A`);
    execSync(`git -C "${seed}" -c user.email=seed@x -c user.name=seed commit --quiet -m init`);
    execSync(`git -C "${seed}" push --quiet origin main`);
    await rm(seed, { recursive: true });

    // Klona för anna och björn
    execSync(`git clone --quiet "${bare}" "${anna}"`);
    execSync(`git clone --quiet "${bare}" "${bjorn}"`);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // ────────────────────────────────────────────────────────────────
  // Local operations
  // ────────────────────────────────────────────────────────────────

  it("commit returnerar commit-objekt med hash + meddelande + author", async () => {
    const ops = new NodeGitOps(anna, "Anna", "anna@x");
    await writeFile(join(anna, "a.txt"), "hej");
    const c = await ops.commit("Första");
    expect(c.hash).toMatch(/^[a-f0-9]+$/);
    expect(c.message).toBe("Första");
    expect(c.author).toBe("Anna");
    expect(c.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("localHead returnerar senaste commiten", async () => {
    const ops = new NodeGitOps(anna, "Anna", "anna@x");
    await writeFile(join(anna, "a.txt"), "x");
    const c = await ops.commit("ny");
    const head = await ops.localHead();
    expect(head.hash).toBe(c.hash);
  });

  it("commit utan filändringar — returnerar samma head", async () => {
    const ops = new NodeGitOps(anna, "Anna", "anna@x");
    const before = await ops.localHead();
    const c = await ops.commit("tom (allow-empty)");
    expect(c.hash).not.toBe(before.hash);
    expect((await ops.localHead()).hash).toBe(c.hash);
  });

  it("pendingCommitsAhead är tom direkt efter clone", async () => {
    const ops = new NodeGitOps(anna, "Anna", "anna@x");
    expect(await ops.pendingCommitsAhead()).toEqual([]);
  });

  it("pendingCommitsAhead listar lokala commits inte ännu pushade", async () => {
    const ops = new NodeGitOps(anna, "Anna", "anna@x");
    await writeFile(join(anna, "a.txt"), "x");
    await ops.commit("A1");
    await writeFile(join(anna, "b.txt"), "y");
    await ops.commit("A2");
    const pending = await ops.pendingCommitsAhead();
    expect(pending).toHaveLength(2);
    expect(pending.map((c) => c.message)).toEqual(["A1", "A2"]);
  });

  // ────────────────────────────────────────────────────────────────
  // Push CAS
  // ────────────────────────────────────────────────────────────────

  it("första push lyckas", async () => {
    const ops = new NodeGitOps(anna, "Anna", "anna@x");
    await writeFile(join(anna, "a.txt"), "x");
    await ops.commit("A1");
    const result = await ops.push();
    expect(result.ok).toBe(true);
  });

  it("konkurrens: en pushar, andra får NonFastForward", async () => {
    const annaOps = new NodeGitOps(anna, "Anna", "anna@x");
    const bjornOps = new NodeGitOps(bjorn, "Björn", "bjorn@x");

    await writeFile(join(anna, "a.txt"), "anna");
    await annaOps.commit("A1");
    await writeFile(join(bjorn, "b.txt"), "björn");
    await bjornOps.commit("B1");

    const a = await annaOps.push();
    const b = await bjornOps.push();

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
    expect(b.reason).toBe("NonFastForward");
  });

  it("efter NonFastForward kan klienten reset, rebuild:a, pusha", async () => {
    const annaOps = new NodeGitOps(anna, "Anna", "anna@x");
    const bjornOps = new NodeGitOps(bjorn, "Björn", "bjorn@x");

    await writeFile(join(anna, "a.txt"), "anna");
    await annaOps.commit("A");
    await writeFile(join(bjorn, "b.txt"), "björn");
    await bjornOps.commit("B");

    await annaOps.push();
    expect((await bjornOps.push()).ok).toBe(false);

    await bjornOps.resetHardToRemote();
    expect(await bjornOps.pendingCommitsAhead()).toEqual([]);

    await writeFile(join(bjorn, "b2.txt"), "ovanpå anna");
    await bjornOps.commit("B på toppen av A");
    expect((await bjornOps.push()).ok).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────
  // Fetch
  // ────────────────────────────────────────────────────────────────

  it("fetch hämtar Annas push så Björn ser den i remoteHead", async () => {
    const annaOps = new NodeGitOps(anna, "Anna", "anna@x");
    const bjornOps = new NodeGitOps(bjorn, "Björn", "bjorn@x");

    await writeFile(join(anna, "a.txt"), "anna");
    await annaOps.commit("AnnasCommit");
    await annaOps.push();

    await bjornOps.fetch();
    const remote = await bjornOps.remoteHead();
    expect(remote.message).toBe("AnnasCommit");
  });

  it("resetHardToRemote applicerar Annas pushed-state på Björns working tree", async () => {
    const annaOps = new NodeGitOps(anna, "Anna", "anna@x");
    const bjornOps = new NodeGitOps(bjorn, "Björn", "bjorn@x");

    await writeFile(join(anna, "newfile.txt"), "Annas-fil");
    await annaOps.commit("Skapa newfile");
    await annaOps.push();

    await bjornOps.fetch();
    await bjornOps.resetHardToRemote();
    // Filen ska finnas i björns workdir efter reset
    const content = execSync(`cat "${join(bjorn, "newfile.txt")}"`).toString();
    expect(content).toBe("Annas-fil");
  });
});
