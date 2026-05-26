/**
 * Integration: `SyncLoop` mot riktig git med två klienter.
 *
 * Bevisar att hela syncen — fetch → diff → reset → hydrate-callback —
 * fungerar identiskt mot subprocess-git som mot InMemory-mocken.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync, spawnSync } from "node:child_process";
import { SyncLoop } from "@/lib/server/local-first/sync-loop";
import { NodeFileSystem } from "@/lib/server/local-first/node-fs";
import { NodeGitOps } from "@/lib/server/local-first/node-git-ops";
import {
  ProjectionWriter,
  ProjectionHydrator,
} from "@/lib/server/local-first/projection-writer";
import { buildDefaultRegistry } from "@/lib/server/local-first/projections/default-registry";
import type { MatterProjectionData } from "@/lib/server/local-first/projections/matter";

function hasGit(): boolean {
  return spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0;
}
const skipIfNoGit = hasGit() ? describe : describe.skip;

const sampleMatter: MatterProjectionData = {
  id: "m1",
  matterNumber: "2026-0001",
  title: "Vårdnadstvist",
  status: "ACTIVE",
  organizationId: "org-1",
};

skipIfNoGit("SyncLoop — integration mot riktig git", () => {
  let root: string;
  let bare: string;
  let annaDir: string;
  let bjornDir: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "ava-sli-"));
    bare = join(root, "origin.git");
    annaDir = join(root, "anna");
    bjornDir = join(root, "bjorn");
  });

  beforeEach(async () => {
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });
    execSync(`git init --bare --quiet --initial-branch=main "${bare}"`);
    const seed = join(root, "_seed");
    execSync(`git clone --quiet "${bare}" "${seed}"`);
    execSync(`touch "${seed}/.gitkeep"`);
    execSync(`git -C "${seed}" -c user.email=s@x -c user.name=s add -A`);
    execSync(`git -C "${seed}" -c user.email=s@x -c user.name=s commit --quiet -m init`);
    execSync(`git -C "${seed}" push --quiet origin main`);
    await rm(seed, { recursive: true });
    execSync(`git clone --quiet "${bare}" "${annaDir}"`);
    execSync(`git clone --quiet "${bare}" "${bjornDir}"`);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("Anna projicierar+pushar; Björns SyncLoop fetchar och callbackar", async () => {
    // Anna: projicera matter + push
    const annaFs = new NodeFileSystem(annaDir);
    const annaGit = new NodeGitOps(annaDir, "anna", "anna@x");
    const annaWriter = new ProjectionWriter(annaFs, buildDefaultRegistry());
    await annaWriter.project("matter", sampleMatter);
    await annaGit.commit("Skapa matter");
    expect((await annaGit.push()).ok).toBe(true);

    // Björn: SyncLoop tickar
    const bjornFs = new NodeFileSystem(bjornDir);
    const bjornGit = new NodeGitOps(bjornDir, "bjorn", "bjorn@x");
    const hydrator = new ProjectionHydrator(bjornFs, buildDefaultRegistry());
    const onHydrated = vi.fn();
    const loop = new SyncLoop({ git: bjornGit, hydrator, onHydrated });

    const result = await loop.tickOnce();
    expect(result.hadChanges).toBe(true);
    expect(result.changedPaths).toContain("matters/active/m1.json");
    expect(result.hydrated).toBe(1);
    expect(onHydrated).toHaveBeenCalledTimes(1);
    const [entity, data] = onHydrated.mock.calls[0];
    expect(entity).toBe("matter");
    expect((data as { id: string }).id).toBe("m1");
  });

  it("två successiva tick — andra ser inga ändringar", async () => {
    const annaFs = new NodeFileSystem(annaDir);
    const annaGit = new NodeGitOps(annaDir, "anna", "anna@x");
    const annaWriter = new ProjectionWriter(annaFs, buildDefaultRegistry());
    await annaWriter.project("matter", sampleMatter);
    await annaGit.commit("c");
    await annaGit.push();

    const bjornFs = new NodeFileSystem(bjornDir);
    const bjornGit = new NodeGitOps(bjornDir, "bjorn", "bjorn@x");
    const hydrator = new ProjectionHydrator(bjornFs, buildDefaultRegistry());
    const onHydrated = vi.fn();
    const loop = new SyncLoop({ git: bjornGit, hydrator, onHydrated });

    const t1 = await loop.tickOnce();
    expect(t1.hadChanges).toBe(true);

    const t2 = await loop.tickOnce();
    expect(t2.hadChanges).toBe(false);
    expect(onHydrated).toHaveBeenCalledTimes(1);
  });

  it("skippar tick när Björn har lokala commits ahead", async () => {
    const bjornFs = new NodeFileSystem(bjornDir);
    const bjornGit = new NodeGitOps(bjornDir, "bjorn", "bjorn@x");
    await bjornFs.writeFile("local-only.txt", "Björns oskickade");
    await bjornGit.commit("Lokal commit");

    const hydrator = new ProjectionHydrator(bjornFs, buildDefaultRegistry());
    const onHydrated = vi.fn();
    const loop = new SyncLoop({ git: bjornGit, hydrator, onHydrated });
    const result = await loop.tickOnce();
    expect(result.skippedReason).toBe("local-ahead");
  });
});
