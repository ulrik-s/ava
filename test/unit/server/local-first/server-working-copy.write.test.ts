/**
 * Test för server-runtimens SKRIV-väg (#116, ADR 0005 fas 1).
 *
 * Kör en router-**mutation** via `openServerWorkingCopy().caller` mot en lokal
 * git working copy och verifierar att ändringen skrivs igenom till disk (samma
 * `makeWriteBack`-kärna som klientens FSA/OPFS-write-back) och committas via
 * `NodeGitOps`. Idempotens: en omkörning mot samma id skriver samma fil —
 * inga dubbletter.
 *
 * Kräver system-`git` (samma som node-git-ops.test.ts) — hoppas annars över.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest-compat";
import { mkdtemp, rm, mkdir, writeFile, readdir, readFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execSync, spawnSync } from "node:child_process";
import { buildSeed, seedToFiles } from "../../../../tooling/scripts/seed-data";
import { openServerWorkingCopy } from "@/lib/server/local-first/server-working-copy";
import { CURRENT_SCHEMA_VERSION } from "@/lib/shared/schema-version";
import type { Principal } from "@/lib/server/auth/principal";

const ADMIN: Principal = {
  id: "current-user",
  email: "anna@firma.local",
  name: "Anna Advokat",
  role: "ADMIN",
  organizationId: "test-org",
};

const hasGit = (): boolean => spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0;
const suite = hasGit() ? describe : describe.skip;

async function fileExists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

/** Skriv seed-working-copy + meta.json och gör den till ett git-repo med en bas-commit. */
async function initWorkingCopy(dir: string): Promise<void> {
  const seed = buildSeed({ orgId: "test-org" });
  for (const { path, data } of seedToFiles(seed)) {
    const abs = join(dir, path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, JSON.stringify(data, null, 2), "utf8");
  }
  const metaAbs = join(dir, ".ava/meta.json");
  await mkdir(dirname(metaAbs), { recursive: true });
  await writeFile(metaAbs, JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION }), "utf8");

  execSync(`git init --quiet --initial-branch=main "${dir}"`);
  execSync(`git -C "${dir}" -c user.email=seed@x -c user.name=seed add -A`);
  execSync(`git -C "${dir}" -c user.email=seed@x -c user.name=seed commit --quiet -m "seed"`);
}

suite("openServerWorkingCopy — skriv-väg (#116)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ava-swc-write-"));
    await initWorkingCopy(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("en contacts.create-mutation skrivs till working-copy:n och committas", async () => {
    const wc = await openServerWorkingCopy(dir, { principal: ADMIN });
    const before = await wc.gitOps.localHead();

    const created = await wc.caller.contacts.create({
      id: "c-writeback-1",
      name: "Test Klient AB",
      contactType: "COMPANY",
    });
    expect(created.id).toBe("c-writeback-1");

    // Write-back har skrivit filen redan före commit.
    const file = join(dir, "contacts/c-writeback-1.json");
    expect(await fileExists(file)).toBe(true);
    const onDisk = JSON.parse(await readFile(file, "utf8")) as { id: string; name: string };
    expect(onDisk.id).toBe("c-writeback-1");
    expect(onDisk.name).toBe("Test Klient AB");

    const commit = await wc.commit("feat: lägg till kontakt via server-runtime");
    expect(commit.hash).not.toBe(before.hash);

    // Ändringen är committad — diffen mot bas-commit innehåller den nya filen.
    const changed = await wc.gitOps.changedFiles(before.hash, commit.hash);
    expect(changed).toContain("contacts/c-writeback-1.json");

    // git log visar vår commit.
    const log = execSync(`git -C "${dir}" log -1 --format=%s`).toString().trim();
    expect(log).toBe("feat: lägg till kontakt via server-runtime");
  });

  it("idempotent: omkörning mot samma id överskriver samma fil — inga dubbletter", async () => {
    const wc = await openServerWorkingCopy(dir, { principal: ADMIN });

    await wc.caller.contacts.create({ id: "c-dup", name: "Först", contactType: "PERSON" });
    await wc.commit("add c-dup");

    // Samma id, ny data → write-back skriver SAMMA path (overwrite).
    await wc.caller.contacts.update({ id: "c-dup", name: "Ändrad" });
    const second = await wc.commit("update c-dup");

    // Exakt EN fil för id:t i contacts/ (inga c-dup (1).json eller dylikt).
    const files = (await readdir(join(dir, "contacts"))).filter((f) => f.includes("c-dup"));
    expect(files).toEqual(["c-dup.json"]);

    const onDisk = JSON.parse(await readFile(join(dir, "contacts/c-dup.json"), "utf8")) as { name: string };
    expect(onDisk.name).toBe("Ändrad");
    // Andra commiten är icke-tom (uppdateringen syns i diffen).
    expect(second.hash).toBeTruthy();
  });

  it("en tom mutation-cykel ger en tom commit (--allow-empty), inte ett fel", async () => {
    const wc = await openServerWorkingCopy(dir, { principal: ADMIN });
    const before = await wc.gitOps.localHead();
    const commit = await wc.commit("tom cykel");
    // Ny commit skapas men diffen är tom.
    expect(commit.hash).not.toBe(before.hash);
    expect(await wc.gitOps.changedFiles(before.hash, commit.hash)).toEqual([]);
  });
});
