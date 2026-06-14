/**
 * Test för server-runtime C — git-peer-loopen (#117, uppfyller #77:s "Klar när").
 *
 * Servern klonar firma.git, kör en mutation mot sin clone och pushar
 * konflikt-säkert tillbaka. Verifierar:
 *   1. happy path: clone → pull-act-push → remote har den nya raden (1 försök).
 *   2. konflikt-säkerhet: en konkurrent pushar mellan vår reset och vår push
 *      → CAS-pushen failar → cykeln synkar, re-agerar (idempotent) och pushar
 *      → remote har BÅDA ändringarna (additivt, ingen clobber).
 *
 * Kräver system-`git` (samma som node-git-ops.test.ts) — hoppas annars över.
 */

import { execSync, spawnSync } from "node:child_process";
import { mkdtemp, rm, readdir, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest-compat";
import type { Principal } from "@/lib/server/auth/principal";
import { cloneWorkingCopy, runPeerCycle } from "@/lib/server/local-first/server-peer";
import { CURRENT_SCHEMA_VERSION } from "@/lib/shared/schema-version";

const ADMIN: Principal = {
  id: "current-user",
  email: "anna@firma.local",
  name: "Anna Advokat",
  role: "ADMIN",
  organizationId: "test-org",
};

const hasGit = (): boolean => spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0;
const suite = hasGit() ? describe : describe.skip;

const GID = `-c user.email=t@x -c user.name=t`;

suite("server-peer — klona + pull→act→push (#117)", () => {
  let root: string;
  let bare: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "ava-peer-"));
    bare = join(root, "firma.git");
    execSync(`git init --bare --quiet --initial-branch=main "${bare}"`);
    // Seeda en minimal firma.git (bara meta.json) via en throwaway clone.
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

  /** Lista filer på en path i remote (via en throwaway clone). */
  async function remoteFiles(sub: string): Promise<string[]> {
    const v = join(root, `_verify-${sub.replace(/\W/g, "")}`);
    await rm(v, { recursive: true, force: true });
    execSync(`git clone --quiet "${bare}" "${v}"`);
    const files = await readdir(join(v, sub)).catch(() => [] as string[]);
    await rm(v, { recursive: true, force: true });
    return files;
  }

  /** Simulera en konkurrerande peer som pushar en additiv ändring. */
  function competitorPush(fileName: string): void {
    const c = join(root, "_competitor");
    rmrf(c);
    execSync(`git clone --quiet "${bare}" "${c}"`);
    execSync(`bash -c 'echo race > "${c}/${fileName}"'`);
    execSync(`git -C "${c}" ${GID} add -A`);
    execSync(`git -C "${c}" ${GID} commit --quiet -m competitor`);
    execSync(`git -C "${c}" push --quiet origin main`);
    rmrf(c);
  }

  function rmrf(p: string): void {
    spawnSync("rm", ["-rf", p]);
  }

  let peerDir: string;
  beforeEach(async () => {
    // Klona till en färsk under-katalog (git clone skapar `peer/` själv).
    peerDir = join(await mkdtemp(join(root, "peerparent-")), "peer");
    await cloneWorkingCopy({ url: bare, dir: peerDir });
  });

  it("happy path: klonar, kör mutation, pushar (1 försök)", async () => {
    const res = await runPeerCycle(
      peerDir,
      async (caller) => { await caller.contacts.create({ id: "c-happy", name: "Glad Klient", contactType: "COMPANY" }); },
      "feat: lägg till c-happy via peer",
      { principal: ADMIN },
    );
    expect(res.pushed).toBe(true);
    expect(res.attempts).toBe(1);
    // Remote har nu kontakten.
    expect(await remoteFiles("contacts")).toContain("c-happy.json");
  });

  it("no-op: act utan ändringar → ingen commit/push (noop) (#80)", async () => {
    const headBefore = execSync(`git -C "${bare}" rev-parse main`).toString().trim();
    const res = await runPeerCycle(
      peerDir,
      async () => { /* en regel-tick utan nya effekter */ },
      "chore: tom regel-tick",
      { principal: ADMIN },
    );
    expect(res.noop).toBe(true);
    expect(res.pushed).toBe(false);
    // Remote-HEAD oförändrad → ingen tom commit pushad.
    expect(execSync(`git -C "${bare}" rev-parse main`).toString().trim()).toBe(headBefore);
  });

  it("konflikt-säkert: konkurrent-push mellan reset och push → retry + additivt resultat", async () => {
    let raced = false;
    const res = await runPeerCycle(
      peerDir,
      async (caller) => {
        await caller.contacts.create({ id: "c-peer", name: "Peer Klient", contactType: "PERSON" });
        // Bara på första försöket: en konkurrent driver fram remote EFTER vår
        // reset men FÖRE vår push → vår CAS-push blir NonFastForward.
        if (!raced) {
          raced = true;
          competitorPush("competitor.txt");
        }
      },
      "feat: lägg till c-peer via peer",
      { principal: ADMIN, maxRetries: 3 },
    );

    expect(res.pushed).toBe(true);
    expect(res.attempts).toBe(2); // ett misslyckat + ett lyckat
    // Additivt: remote har BÅDE konkurrentens fil OCH vår kontakt.
    const rootFiles = await remoteFiles(".");
    expect(rootFiles).toContain("competitor.txt");
    const contacts = await remoteFiles("contacts");
    // Exakt EN c-peer-fil — idempotent, ingen dubblett (t.ex. "c-peer (1).json").
    expect(contacts.filter((f) => f.includes("c-peer"))).toEqual(["c-peer.json"]);
  });
});
