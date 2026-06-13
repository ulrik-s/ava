/**
 * Test för server-runtime D (#118) — startServerRuntime mot riktig git.
 *
 * Verifierar composition-root:en end-to-end:
 *   1. klon-om-saknas: tom workDir → klonar firma.git.
 *   2. återanvänd: befintlig working-copy klonas inte om.
 *   3. sync-läge (inget job): en tick hämtar remote-ändringar till working-copy:n.
 *   4. cykel-läge (job): en tick kör mutation + pushar till remote.
 *
 * Kräver system-`git` (som server-peer.test.ts) — hoppas annars över.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import { mkdtemp, rm, readdir, mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync, spawnSync } from "node:child_process";

import { startServerRuntime } from "@/lib/server/local-first/server-runtime";
import type { RuntimeConfig } from "@/lib/server/local-first/server-runtime-config";
import { CURRENT_SCHEMA_VERSION } from "@/lib/shared/schema-version";

const PRINCIPAL: RuntimeConfig["principal"] = {
  id: "server-runtime",
  email: "sr@ava.local",
  name: "AVA Server-runtime",
  role: "ADMIN",
  organizationId: "test-org",
};

const hasGit = (): boolean => spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0;
const suite = hasGit() ? describe : describe.skip;
const GID = `-c user.email=t@x -c user.name=t`;

function cfg(over: Partial<RuntimeConfig>): RuntimeConfig {
  return {
    repoUrl: "",
    workDir: "",
    branch: "main",
    remote: "origin",
    pollIntervalMs: 600_000, // högt → interval-timern firar inte under testet
    maxRetries: 3,
    httpHost: "127.0.0.1",
    apiTokens: [],
    principal: PRINCIPAL,
    ...over,
  };
}

suite("startServerRuntime (#118)", () => {
  let root: string;
  let bare: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "ava-sr-"));
    bare = join(root, "firma.git");
    execSync(`git init --bare --quiet --initial-branch=main "${bare}"`);
    const seed = join(root, "_seed");
    execSync(`git clone --quiet "${bare}" "${seed}"`);
    await mkdir(join(seed, ".ava"), { recursive: true });
    await writeFile(join(seed, ".ava/meta.json"), JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION }));
    execSync(`git -C "${seed}" ${GID} add -A`);
    execSync(`git -C "${seed}" ${GID} commit --quiet -m seed`);
    execSync(`git -C "${seed}" push --quiet origin main`);
    await rm(seed, { recursive: true, force: true });
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function freshWorkDir(name: string): Promise<string> {
    return join(await mkdtemp(join(root, `${name}-`)), "wc");
  }

  const exists = (p: string): Promise<boolean> => access(p).then(() => true, () => false);

  /** En konkurrent pushar en ny fil till remote. */
  function competitorPush(fileName: string): void {
    const c = join(root, "_competitor");
    spawnSync("rm", ["-rf", c]);
    execSync(`git clone --quiet "${bare}" "${c}"`);
    execSync(`bash -c 'echo hej > "${c}/${fileName}"'`);
    execSync(`git -C "${c}" ${GID} add -A`);
    execSync(`git -C "${c}" ${GID} commit --quiet -m competitor`);
    execSync(`git -C "${c}" push --quiet origin main`);
    spawnSync("rm", ["-rf", c]);
  }

  it("klonar firma.git när working-copy:n saknas", async () => {
    const workDir = await freshWorkDir("clone");
    const loop = await startServerRuntime(cfg({ repoUrl: bare, workDir }));
    loop.stop();
    expect(await exists(join(workDir, ".git"))).toBe(true);
    expect(await exists(join(workDir, ".ava/meta.json"))).toBe(true);
  });

  it("återanvänder en befintlig working-copy (klonar inte om)", async () => {
    const workDir = await freshWorkDir("reuse");
    const first = await startServerRuntime(cfg({ repoUrl: bare, workDir }));
    first.stop();
    // En andra start mot samma dir får INTE klona om — injicera en clone som kastar.
    const second = await startServerRuntime(cfg({ repoUrl: bare, workDir }), {
      clone: async () => { throw new Error("clone borde inte anropas för befintlig wc"); },
    });
    second.stop();
    expect(await exists(join(workDir, ".git"))).toBe(true);
  });

  it("sync-läge: en tick hämtar remote-ändringar in i working-copy:n", async () => {
    const workDir = await freshWorkDir("sync");
    const loop = await startServerRuntime(cfg({ repoUrl: bare, workDir }));
    competitorPush("nyfil.txt");
    const tick = await loop.tickOnce();
    loop.stop();
    expect(tick.mode).toBe("sync");
    expect(await exists(join(workDir, "nyfil.txt"))).toBe(true);
  });

  it("cykel-läge: en tick kör mutation + pushar till remote", async () => {
    const workDir = await freshWorkDir("cycle");
    const loop = await startServerRuntime(cfg({ repoUrl: bare, workDir }), {
      job: {
        act: async (caller) => {
          await caller.contacts.create({ id: "c-sr", name: "SR Klient", contactType: "COMPANY" });
        },
        message: "feat: lägg till c-sr via server-runtime",
      },
    });
    const tick = await loop.tickOnce();
    loop.stop();
    expect(tick.mode).toBe("cycle");
    if (tick.mode === "cycle") expect(tick.result.pushed).toBe(true);
    // Remote har kontakten (verifiera via en throwaway clone).
    const v = join(root, "_verify");
    spawnSync("rm", ["-rf", v]);
    execSync(`git clone --quiet "${bare}" "${v}"`);
    const contacts = await readdir(join(v, "contacts")).catch(() => [] as string[]);
    spawnSync("rm", ["-rf", v]);
    expect(contacts).toContain("c-sr.json");
  });
});
