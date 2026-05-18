/**
 * Integration-test: `LocalGitStore` mot riktig git + filsystem.
 *
 * Detta är "full stack-testet" för local-first-kernel:n. Skapar:
 *   - En bare remote git-repo
 *   - Två clones (Anna + Björn)
 *   - LocalGitStore-instanser för bägge
 *
 * Och verifierar:
 *   - Events emittas till fil-loggen och persisterar på disk
 *   - Claims via push-CAS funkar mellan konkurrerande klienter
 *   - Anna's claim är synlig för Björn efter fetch+reset
 *
 * Det här är **exakt det scenario** som arkitekturen beror på.
 * Spike:n validerade konkurrensen med rena git-anrop; nu validerar vi
 * att hela API-laget håller ihop.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync, spawnSync } from "node:child_process";
import { LocalGitStore } from "@/server/local-first/local-git-store";
import { NodeFileSystem } from "@/server/local-first/node-fs";
import { NodeGitOps } from "@/server/local-first/node-git-ops";
import { vi } from "vitest";

function hasGit(): boolean {
  return spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0;
}
const skipIfNoGit = hasGit() ? describe : describe.skip;

function makePrismaMock() {
  const delegate = () => ({
    findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(),
    create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn(),
  });
  return {
    matter: delegate(), matterContact: delegate(), contact: delegate(),
    document: delegate(), documentFolder: delegate(),
    documentTemplate: delegate(), documentAnalysisSuggestion: delegate(),
    matterEventSuggestion: delegate(), invoice: delegate(),
    timeEntry: delegate(), expense: delegate(), user: delegate(),
    organization: delegate(), office: delegate(), conflictCheck: delegate(),
  } as never;
}

skipIfNoGit("LocalGitStore — integration mot riktig git", () => {
  let root: string;
  let bare: string;
  let annaDir: string;
  let bjornDir: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "ava-lgsi-"));
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

  function buildStore(dir: string, me: string): LocalGitStore {
    const fs = new NodeFileSystem(dir);
    const git = new NodeGitOps(dir, me, `${me}@x`);
    return new LocalGitStore({ fs, git, me, prisma: makePrismaMock() });
  }

  it("emit skriver event till JSONL-fil i working tree", async () => {
    const store = buildStore(annaDir, "anna");
    const event = await store.events.emit({
      type: "matter.created",
      source: "ui",
      actor: { kind: "user", id: "anna" },
      payload: { matterNumber: "2026-0001" },
    });
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);

    // Filen på disk
    const today = new Date(event.ts);
    const path = `events/${today.getUTCFullYear()}/${String(today.getUTCMonth() + 1).padStart(2, "0")}/${String(today.getUTCDate()).padStart(2, "0")}.jsonl`;
    const content = execSync(`cat "${join(annaDir, path)}"`).toString();
    expect(content).toContain("matter.created");
    expect(content).toContain("2026-0001");
  });

  it("emit + query end-to-end persisterar och läser tillbaka samma event", async () => {
    const store = buildStore(annaDir, "anna");
    await store.events.emit({
      type: "matter.created",
      source: "ui",
      actor: { kind: "user", id: "anna" },
      matterId: "m1",
      payload: {},
    });
    const events = await store.events.query({});
    expect(events).toHaveLength(1);
    expect(events[0].matterId).toBe("m1");
  });

  it("claim via push-CAS: Anna vinner, Björn ser false efter fetch", async () => {
    const annaStore = buildStore(annaDir, "anna");
    const bjornStore = buildStore(bjornDir, "bjorn");

    const annaResult = await annaStore.claims!.tryClaim("rule:r@e1", { me: "anna" });
    const bjornResult = await bjornStore.claims!.tryClaim("rule:r@e1", { me: "bjorn" });

    expect(annaResult).toBe(true);
    expect(bjornResult).toBe(false);
  });

  it("Björn ser Annas event efter git fetch + reset", async () => {
    const annaStore = buildStore(annaDir, "anna");
    const bjornStore = buildStore(bjornDir, "bjorn");

    await annaStore.events.emit({
      type: "matter.created",
      source: "ui",
      actor: { kind: "user", id: "anna" },
      payload: { matterNumber: "2026-9999" },
    });
    // Anna måste commita + pusha för att Björn ska kunna se
    const annaGit = new NodeGitOps(annaDir, "anna", "anna@x");
    await annaGit.commit("Annas event");
    await annaGit.push();

    const bjornGit = new NodeGitOps(bjornDir, "bjorn", "bjorn@x");
    await bjornGit.resetHardToRemote();

    const events = await bjornStore.events.query({});
    expect(events).toHaveLength(1);
    expect((events[0].payload as { matterNumber?: string }).matterNumber).toBe("2026-9999");
  });
});
