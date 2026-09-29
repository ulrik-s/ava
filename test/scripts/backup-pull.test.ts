/**
 * `backup-pull.sh` (#1079, #1254) — hämtaren på byråns egen dator.
 *
 * Kör det riktiga skriptet med fejkade `sftp` (en lokal katalog är "servern")
 * och `age` (arkiven i testet är okrypterade tar-filer) på PATH, så att
 * logiken testas utan nät och nycklar:
 *   - nya exporter hämtas, verifieras och markeras,
 *   - en trasig checksumma larmar och den trasiga filen tas bort,
 *   - ANDRA BACKUPMÅLET (#1254): verifierade exporter kopieras till
 *     `AVA_BACKUP_MIRROR` (annan disk/NAS/molnmapp), en gång, och kopian
 *     kontrolleras. En omonterad spegel larmar i stället för att tyst bli en
 *     lokal katalog.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest-compat";

const SCRIPT = join(process.cwd(), "tooling/scripts/backup-pull.sh");

let root = "";
let remote = "";
let dest = "";
let bin = "";

/** En "export": en tar med SHA256SUMS i (som backup-export.sh gör), plus sin checksumma. */
function makeExport(name: string): void {
  const stage = join(root, `stage-${name}`);
  mkdirSync(stage);
  writeFileSync(join(stage, "SHA256SUMS"), "x  ./ava.sql.gz\n");
  spawnSync("bash", ["-c", `tar -C "${stage}" -cf "${join(remote, name)}" . && cd "${remote}" && sha256sum "${name}" > "${name}.sha256"`]);
}

function shim(name: string, body: string): void {
  const p = join(bin, name);
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(p, 0o755);
}

function run(env: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("bash", [SCRIPT, dest], {
    encoding: "utf8",
    env: {
      ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`,
      AVA_BACKUP_HOST: "avabackup@test", AVA_BACKUP_KEY: join(root, "key"), FAKE_REMOTE: remote, ...env,
    },
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ava-pull-"));
  remote = join(root, "remote");
  dest = join(root, "dest");
  bin = join(root, "bin");
  for (const d of [remote, bin]) mkdirSync(d);
  writeFileSync(join(root, "key"), "AGE-SECRET-KEY-TEST");
  // sftp -b -: läs kommandona från stdin; "ls -1" listar, "get -p X" kopierar hit.
  shim("sftp", `while read -r cmd a b; do
  case "$cmd" in
    ls) ls -1 "$FAKE_REMOTE" ;;
    get) cp -p "$FAKE_REMOTE/$b" . ;;
  esac
done`);
  // age -d -i KEY FILE → arkiven är redan okrypterade.
  shim("age", `cat "\${@: -1}"`);
  shim("osascript", "true");
  makeExport("ava-2026-09-28-0300.tar.age");
});

afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("backup-pull.sh — hämtning", () => {
  it("hämtar, verifierar och markerar nya exporter", () => {
    const { status, out } = run();
    expect(status, out).toBe(0);
    expect(out).toContain("✓ ava-2026-09-28-0300.tar.age");
    expect(existsSync(join(dest, "ava-2026-09-28-0300.tar.age.verified"))).toBe(true);
  });

  it("trasig checksumma → larm, och den trasiga filen tas bort", () => {
    writeFileSync(join(remote, "ava-2026-09-28-0300.tar.age.sha256"), `${"0".repeat(64)}  ava-2026-09-28-0300.tar.age\n`);
    const { status, out } = run();
    expect(status).toBe(1);
    expect(out).toMatch(/checksumman stämmer inte/);
    expect(existsSync(join(dest, "ava-2026-09-28-0300.tar.age"))).toBe(false);
  });
});

describe("backup-pull.sh — andra backupmålet (AVA_BACKUP_MIRROR, #1254)", () => {
  it("verifierade exporter kopieras till spegeln, med checksumma", () => {
    const mirror = join(root, "nas");
    mkdirSync(mirror);
    const { status, out } = run({ AVA_BACKUP_MIRROR: mirror });
    expect(status, out).toBe(0);
    expect(readdirSync(mirror).sort()).toEqual(["ava-2026-09-28-0300.tar.age", "ava-2026-09-28-0300.tar.age.sha256"]);
    expect(out).toMatch(/spegel.*ava-2026-09-28-0300\.tar\.age/i);
  });

  it("en andra körning kopierar inget igen — bara nya exporter", () => {
    const mirror = join(root, "nas");
    mkdirSync(mirror);
    run({ AVA_BACKUP_MIRROR: mirror });
    makeExport("ava-2026-09-29-0300.tar.age");
    const { status } = run({ AVA_BACKUP_MIRROR: mirror });
    expect(status).toBe(0);
    expect(readdirSync(mirror).filter((f) => f.endsWith(".tar.age")).sort())
      .toEqual(["ava-2026-09-28-0300.tar.age", "ava-2026-09-29-0300.tar.age"]);
  });

  it("spegeln saknas (t.ex. omonterad NAS) → larm, och ingen lokal katalog skapas i dess ställe", () => {
    const mirror = join(root, "Volumes", "NAS");
    const { status, out } = run({ AVA_BACKUP_MIRROR: mirror });
    expect(status).toBe(1);
    expect(out).toMatch(/andra backupplatsen/i);
    expect(existsSync(mirror)).toBe(false);
  });

  it("en skadad kopia i spegeln upptäcks → larm", () => {
    const mirror = join(root, "nas");
    mkdirSync(mirror);
    run({ AVA_BACKUP_MIRROR: mirror });
    writeFileSync(join(mirror, "ava-2026-09-28-0300.tar.age"), "förstörd");
    const { status, out } = run({ AVA_BACKUP_MIRROR: mirror });
    expect(status).toBe(1);
    expect(out).toMatch(/spegel.*stämmer inte/i);
  });

  it("utan AVA_BACKUP_MIRROR → som förut (ingen spegling)", () => {
    const { status, out } = run();
    expect(status).toBe(0);
    expect(out).not.toMatch(/spegel/i);
  });
});
