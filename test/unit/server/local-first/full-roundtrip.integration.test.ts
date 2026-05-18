/**
 * Full-stack integration-test: bevisar att hela local-first-paradigmet
 * fungerar end-to-end mot riktig git.
 *
 * Scenariot:
 *   1. Anna skapar en matter via mockad SQLite, emittar matter.created
 *   2. WriteThroughProjector projicerar matter → JSON-fil i hennes working tree
 *   3. Anna commitar + pushar
 *   4. Björn fetchar + resettar
 *   5. ProjectionHydrator läser hennes JSON-fil ur Björns working tree
 *   6. Datat är identiskt med ursprunget
 *
 * Det här är vad arkitekturen lovat sedan dag ett. Om det här passar
 * är hela Fas 3:s kernel komplett — runtime-bindningar (Tauri, Yjs,
 * 15s-poll) är bara orkestrering ovanpå.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync, spawnSync } from "node:child_process";
import { vi } from "vitest";
import { LocalGitStore } from "@/server/local-first/local-git-store";
import { NodeFileSystem } from "@/server/local-first/node-fs";
import { NodeGitOps } from "@/server/local-first/node-git-ops";
import { ProjectionHydrator } from "@/server/local-first/projection-writer";
import { buildDefaultRegistry } from "@/server/local-first/projections/default-registry";
import type { MatterProjectionData } from "@/server/local-first/projections/matter";

function hasGit(): boolean {
  return spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0;
}
const skipIfNoGit = hasGit() ? describe : describe.skip;

const sampleMatter: MatterProjectionData = {
  id: "matter-1",
  matterNumber: "2026-0001",
  title: "Vårdnadstvist",
  status: "ACTIVE",
  organizationId: "org-1",
};

function makeMockPrisma(matters: Record<string, MatterProjectionData>) {
  const delegate = (bag: Record<string, unknown>) => ({
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => bag[where.id] ?? null),
    findFirst: vi.fn(), findMany: vi.fn(),
    create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn(),
  });
  return {
    matter: delegate(matters),
    matterContact: delegate({}), contact: delegate({}), document: delegate({}),
    documentFolder: delegate({}), documentTemplate: delegate({}),
    documentAnalysisSuggestion: delegate({}), matterEventSuggestion: delegate({}),
    invoice: delegate({}), timeEntry: delegate({}), expense: delegate({}),
    user: delegate({}), organization: delegate({}), office: delegate({}),
    conflictCheck: delegate({}),
  } as never;
}

skipIfNoGit("LocalGitStore — full round-trip mot riktig git", () => {
  let root: string;
  let bare: string;
  let annaDir: string;
  let bjornDir: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "ava-full-"));
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

  it("end-to-end: Anna skapar → committar → pushar; Björn pullar → läser tillbaka samma data", async () => {
    // ── 1. Setup Annas store ────────────────────────────────────
    const annaFs = new NodeFileSystem(annaDir);
    const annaGit = new NodeGitOps(annaDir, "anna", "anna@x");
    const annaPrisma = makeMockPrisma({ "matter-1": sampleMatter });
    const annaStore = new LocalGitStore({
      fs: annaFs, git: annaGit, me: "anna", prisma: annaPrisma,
    });

    // ── 2. Simulera router: emit matter.created ────────────────
    await annaStore.events.emit({
      type: "matter.created",
      source: "ui",
      actor: { kind: "user", id: "anna" },
      matterId: "matter-1",
      payload: { matterNumber: "2026-0001", title: "Vårdnadstvist" },
    });

    // Vänta så listenern hinner projicera
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 50));

    expect(await annaFs.exists("matters/active/matter-1.json")).toBe(true);

    // ── 3. Anna committar och pushar ────────────────────────────
    await annaGit.commit("Skapa matter-1");
    const push = await annaGit.push();
    expect(push.ok).toBe(true);

    // ── 4. Björn fetchar och pullar ─────────────────────────────
    const bjornFs = new NodeFileSystem(bjornDir);
    const bjornGit = new NodeGitOps(bjornDir, "bjorn", "bjorn@x");
    await bjornGit.fetch();
    await bjornGit.resetHardToRemote();

    // ── 5. Björn hydratiserar från ändrade filer ────────────────
    const hydrator = new ProjectionHydrator(bjornFs, buildDefaultRegistry());
    const result = await hydrator.hydratePath("matters/active/matter-1.json");

    expect(result).not.toBeNull();
    expect(result!.entity).toBe("matter");
    expect(result!.data).toEqual(sampleMatter);

    // ── 6. Cleanup ──────────────────────────────────────────────
    annaStore.detachProjection();
  });

  it("arkivering över git: matter flyttas till archive/<år>/ för Björn", async () => {
    const annaFs = new NodeFileSystem(annaDir);
    const annaGit = new NodeGitOps(annaDir, "anna", "anna@x");
    const annaPrisma = makeMockPrisma({
      "matter-1": { ...sampleMatter, status: "ARCHIVED", archivedAt: "2024-03-15T10:00:00.000Z" },
    });
    const annaStore = new LocalGitStore({
      fs: annaFs, git: annaGit, me: "anna", prisma: annaPrisma,
    });

    await annaStore.events.emit({
      type: "matter.archived",
      source: "ui",
      actor: { kind: "user", id: "anna" },
      matterId: "matter-1",
      payload: {},
    });
    await new Promise((r) => setTimeout(r, 50));

    await annaGit.commit("Arkivera matter-1");
    await annaGit.push();

    const bjornFs = new NodeFileSystem(bjornDir);
    const bjornGit = new NodeGitOps(bjornDir, "bjorn", "bjorn@x");
    await bjornGit.fetch();
    await bjornGit.resetHardToRemote();

    expect(await bjornFs.exists("matters/archive/2024/matter-1.json")).toBe(true);
    expect(await bjornFs.exists("matters/active/matter-1.json")).toBe(false);

    annaStore.detachProjection();
  });
});
