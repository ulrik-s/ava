/**
 * Deploy via tagg: deploy-latest-tag.sh (körs av ava-deploy.timer) deployar
 * bara när högsta v*-taggen i origin pekar på en annan commit än den
 * deployade releasen — och aldrig om på en tagg som föll.
 *
 * Riktig git (bare origin + klon), deploy-prod.sh ersatt av ett skript som
 * loggar sina argument och lyckas/faller enligt en fil.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";

const ROOT = process.cwd();
let dir: string;
let origin: string;
let clone: string;

function sh(cwd: string, cmd: string, env: Record<string, string> = {}): { code: number; out: string } {
  const r = Bun.spawnSync(["bash", "-c", cmd], { cwd, env: { ...process.env, ...env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  return { code: r.exitCode, out: `${r.stdout.toString()}${r.stderr.toString()}` };
}

const run = (env: Record<string, string> = {}): { code: number; out: string } =>
  sh(clone, "bash tooling/scripts/deploy-latest-tag.sh", { AVA_DEPLOY_CMD: "bash fake-deploy.sh", ...env });
const lastCall = (): string | undefined => calls().split("\n").at(-2);
const calls = (): string => { try { return readFileSync(join(clone, "deploy-calls.log"), "utf8"); } catch { return ""; } };
const tag = (name: string): void => { sh(origin, `git tag ${name}`); };
const commit = (msg: string): void => { sh(origin, `git commit -q --allow-empty -m '${msg}'`); };

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ava-deploy-tag-"));
  origin = join(dir, "origin");
  clone = join(dir, "srv-ava");
  mkdirSync(origin);
  sh(origin, "git init -q -b main && git commit -q --allow-empty -m init");
  sh(dir, `git clone -q origin srv-ava`);
  // Skriptet under test + release-hjälparna, som på servern.
  mkdirSync(join(clone, "tooling/scripts/lib"), { recursive: true });
  for (const f of ["tooling/scripts/deploy-latest-tag.sh", "tooling/scripts/lib/release.sh"]) {
    writeFileSync(join(clone, f), readFileSync(join(ROOT, f)));
  }
  writeFileSync(join(clone, "fake-deploy.sh"), [
    "#!/usr/bin/env bash",
    'echo "$*" >> deploy-calls.log',
    '[ ! -f fail-next ] || { rm -f fail-next; exit 1; }',
    // En lyckad deploy lägger en release som pekar på taggens commit (utan
    // --tag: origin/main, som staging).
    'sha="$(git rev-parse --short "${2:-origin/main}^{commit}")"; mkdir -p releases/"20260101T000000Z-$sha"',
    'ln -sfn "20260101T000000Z-$sha" releases/current',
  ].join("\n"));
});

afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

describe("deploy-latest-tag.sh", () => {
  it("utan v*-tagg: inget händer (helper-v* räknas inte)", () => {
    tag("helper-v0.1.0");
    const r = run();
    expect(r.code).toBe(0);
    expect(calls()).toBe("");
  });

  it("första taggen deployas med --tag", () => {
    tag("v0.1.0");
    expect(run().code).toBe(0);
    expect(calls()).toBe("--tag v0.1.0\n");
  });

  it("samma tagg igen: redan deployad, ingen ny deploy", () => {
    const r = run();
    expect(r.code).toBe(0);
    expect(r.out).toContain("redan deployad");
    expect(calls()).toBe("--tag v0.1.0\n");
  });

  it("högsta versionen vinner, inte senast skapade (v0.10.0 > v0.9.0)", () => {
    commit("två");
    tag("v0.10.0");
    commit("tre");
    tag("v0.9.0");
    expect(run().code).toBe(0);
    expect(calls()).toBe("--tag v0.1.0\n--tag v0.10.0\n");
  });

  it("en fallen tagg körs inte om — tills en ny tagg finns", () => {
    commit("fyra");
    tag("v0.11.0");
    writeFileSync(join(clone, "fail-next"), "");
    expect(run().code).toBe(1);
    const again = run();
    expect(again.code).toBe(1);
    expect(again.out).toContain("föll förra gången");
    expect(calls()).toBe("--tag v0.1.0\n--tag v0.10.0\n--tag v0.11.0\n");
    commit("fem");
    tag("v0.12.0");
    expect(run().code).toBe(0);
    expect(calls()).toBe("--tag v0.1.0\n--tag v0.10.0\n--tag v0.11.0\n--tag v0.12.0\n");
  });

  it("en bootstrap-release räknas som okänd version → deployas", () => {
    commit("sex");
    tag("v0.13.0");
    rmSync(join(clone, "releases/current"));
    mkdirSync(join(clone, "releases/20260101T000000Z-bootstrap"), { recursive: true });
    symlinkSync("20260101T000000Z-bootstrap", join(clone, "releases/current"));
    expect(run().code).toBe(0);
    expect(calls().endsWith("--tag v0.13.0\n")).toBe(true);
  });
});

describe("deploy-latest-tag.sh — staging (AVA_DEPLOY_TRACK=main)", () => {
  const STAGING = { AVA_DEPLOY_TRACK: "main" };

  it("main redan deployad (toppen = senaste taggen): inget händer", () => {
    const r = run(STAGING);
    expect(r.code).toBe(0);
    expect(r.out).toContain("redan deployad");
  });

  it("ny commit på main deployas utan --tag, även utan ny tagg", () => {
    commit("sju");
    const before = calls();
    expect(run(STAGING).code).toBe(0);
    expect(calls()).toBe(`${before}\n`);
    // Produktionen (taggläge) deployar inte en otaggad commit — bara taggen igen.
    expect(run().out).toContain("ny version v0.13.0");
  });

  it("läget kan också stå i ava-server.env", () => {
    commit("åtta");
    writeFileSync(join(clone, "ava-server.env"), 'AVA_DEPLOY_TRACK="main"\n');
    const before = calls();
    expect(run().code).toBe(0);
    expect(calls()).toBe(`${before}\n`);
    rmSync(join(clone, "ava-server.env"));
  });

  it("en fallen commit körs inte om — nästa commit försöker igen", () => {
    commit("nio");
    writeFileSync(join(clone, "fail-next"), "");
    expect(run(STAGING).code).toBe(1);
    const again = run(STAGING);
    expect(again.code).toBe(1);
    expect(again.out).toContain("föll förra gången");
    commit("tio");
    expect(run(STAGING).code).toBe(0);
    expect(lastCall()).toBe("");
  });
});
