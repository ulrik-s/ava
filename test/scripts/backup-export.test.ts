/**
 * `backup-export.sh` (#1896, ADR 0039) — full export, markören och timexporten.
 *
 * Kör det riktiga skriptet med en fejkad `docker` på PATH (som i
 * `restore-db.test.ts`): `pg_dump` ger slumpbytes, volymens tar packar en lokal
 * katalog (med värdens GNU tar, `--newer-mtime` mot markörens sökväg), och
 * "age" släpper igenom tar-strömmen okrypterad — så att testet kan läsa arkivet.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest-compat";

const SCRIPT = join(process.cwd(), "tooling/scripts/backup-export.sh");
const HOUR_S = 3600;
const BASE = "ava-2026-01-01-0300.tar.age";

let root = "";
let out = "";
let content = "";
let log = "";

const FAKE_DOCKER = `#!/usr/bin/env bash
echo "ARGS: $*" >> "$DOCKER_LOG"
dest=""; marker=""; prev=""
for a in "$@"; do
  if [ "$prev" = "-v" ]; then
    case "$a" in *:/out) dest="\${a%:/out}" ;; *:/marker:ro) marker="\${a%:/marker:ro}" ;; esac
  fi
  prev="$a"
done
case "$*" in
  *pg_dump*) head -c 4000 /dev/urandom | base64 ;;
  *content-diff*) tar -C "$FAKE_CONTENT" --newer-mtime="$marker" -czf "$dest/content-diff.tar.gz" . ;;
  *content.tar.gz*) tar -C "$FAKE_CONTENT" -czf "$dest/content.tar.gz" . ;;
  *age*) if [ -n "\${FAKE_AGE_FAIL:-}" ]; then cat > /dev/null; else cat; fi ;;
esac
`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ava-export-"));
  out = join(root, "exports");
  content = join(root, "content");
  log = join(root, "docker.log");
  const bin = join(root, "bin");
  mkdirSync(bin);
  mkdirSync(out);
  mkdirSync(join(content, ".git"), { recursive: true });
  writeFileSync(join(bin, "docker"), FAKE_DOCKER);
  chmodSync(join(bin, "docker"), 0o755);
  writeFileSync(join(root, "recipient.txt"), "age1testmottagare\n");
});

afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function run(args: string[] = [], env: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("bash", [SCRIPT, join(root, "recipient.txt"), out, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`,
      DOCKER_LOG: log, FAKE_CONTENT: content, AVA_COMPOSE: "/dev/null", ...env,
    },
  });
  return { status: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

/** Sätt en fils mtime `ageS` sekunder bakåt. */
function age(path: string, ageS: number): void {
  const t = Date.now() / 1000 - ageS;
  utimesSync(path, t, t);
}

function exports(): string[] {
  return readdirSync(out).filter((n) => n.startsWith("ava-") && n.endsWith(".tar.age")).sort();
}

/** Listan i ett (okrypterat, tack vare den fejkade age) arkiv. */
function listTar(path: string, gz = false): string[] {
  const r = spawnSync("tar", [gz ? "-tzf" : "-tf", path], { encoding: "utf8" });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.split("\n").filter(Boolean);
}

/** Packar upp en fil ur arkivet och läser den. */
function readFromTar(archive: string, member: string): string {
  return spawnSync("tar", ["-xOf", archive, member], { encoding: "utf8" }).stdout;
}

/** En bas i exportkatalogen och en markör som pekar på den, med mtime `markerAgeS` sekunder bakåt. */
function withBase(markerAgeS: number): void {
  writeFileSync(join(out, BASE), "x".repeat(2000));
  writeFileSync(join(out, ".last-full"), `${BASE}\n`);
  age(join(out, ".last-full"), markerAgeS);
}

describe("backup-export.sh: full export och markören", () => {
  it("publicerar exporten med checksumma, och markören bär namnet och starttiden", () => {
    const before = Date.now() / 1000 - 1;
    const r = run();
    expect(r.status, r.out).toBe(0);
    const name = exports()[0] ?? "";
    expect(name).toMatch(/^ava-\d{4}-\d{2}-\d{2}-\d{4}\.tar\.age$/);
    expect(existsSync(join(out, `${name}.sha256`))).toBe(true);
    expect(readFileSync(join(out, ".last-full"), "utf8")).toBe(`${name}\n`);
    const markerMtime = statSync(join(out, ".last-full")).mtimeMs / 1000;
    expect(markerMtime).toBeGreaterThanOrEqual(before);
    expect(markerMtime).toBeLessThanOrEqual(statSync(join(out, name)).mtimeMs / 1000);
    expect(listTar(join(out, name))).toContain("./content.tar.gz");
  });

  it("en misslyckad export lämnar markören orörd", () => {
    writeFileSync(join(out, ".last-full"), "gammal\n");
    age(join(out, ".last-full"), 5 * HOUR_S);
    const mtime = statSync(join(out, ".last-full")).mtimeMs;
    const r = run([], { FAKE_AGE_FAIL: "1" });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/avbryter/);
    expect(readFileSync(join(out, ".last-full"), "utf8")).toBe("gammal\n");
    expect(statSync(join(out, ".last-full")).mtimeMs).toBe(mtime);
    expect(exports()).toEqual([]);
  });

  it("okänt tredje argument ger användningsfel", () => {
    expect(run(["--varje-timme"]).status).toBe(2);
  });
});

describe("backup-export.sh --hourly", () => {
  it("utan markör blir det en full export", () => {
    const r = run(["--hourly"]);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/Ingen bas/);
    const name = exports()[0] ?? "";
    expect(name).not.toMatch(/hourly/);
    expect(readFileSync(join(out, ".last-full"), "utf8")).toBe(`${name}\n`);
  });

  it("med en markör vars bas saknas blir det en full export", () => {
    writeFileSync(join(out, ".last-full"), "ava-2020-01-01-0300.tar.age\n");
    const r = run(["--hourly"]);
    expect(r.status, r.out).toBe(0);
    const made = exports();
    expect(made).toHaveLength(1);
    expect(made[0]).not.toMatch(/hourly/);
  });

  it("med bas: tillägget har dump, ändrade filer, BASE och SHA256SUMS, och markören går till tar", () => {
    writeFileSync(join(content, "gammal.pdf"), "gammal");
    age(join(content, "gammal.pdf"), 3 * HOUR_S);
    withBase(2 * HOUR_S);
    writeFileSync(join(content, "ny.pdf"), "ny");
    writeFileSync(join(content, ".git", "ny-objekt"), "obj");
    const markerMtime = statSync(join(out, ".last-full")).mtimeMs;

    const r = run(["--hourly"]);
    expect(r.status, r.out).toBe(0);
    const hourly = exports().find((n) => n.endsWith("-hourly.tar.age")) ?? "";
    expect(hourly).toMatch(/^ava-\d{4}-\d{2}-\d{2}-\d{4}-hourly\.tar\.age$/);
    expect(existsSync(join(out, `${hourly}.sha256`))).toBe(true);
    const archive = join(out, hourly);
    const members = listTar(archive);
    expect(members).toEqual(expect.arrayContaining(["./content-diff.tar.gz", "./BASE", "./SHA256SUMS"]));
    expect(members.some((m) => /^\.\/ava-.*\.sql\.gz$/.test(m))).toBe(true);
    expect(members).not.toContain("./content.tar.gz");
    expect(readFromTar(archive, "./BASE")).toBe(`${BASE}\n`);
    expect(readFromTar(archive, "./SHA256SUMS")).toMatch(/content-diff\.tar\.gz[\s\S]*BASE/);

    const diffPath = join(root, "diff.tar.gz");
    writeFileSync(diffPath, spawnSync("tar", ["-xOf", archive, "./content-diff.tar.gz"]).stdout);
    const changed = listTar(diffPath, true);
    expect(changed).toEqual(expect.arrayContaining(["./ny.pdf", "./.git/ny-objekt"]));
    expect(changed).not.toContain("./gammal.pdf");

    expect(readFileSync(log, "utf8")).toContain("--newer-mtime=/marker");
    // Markören rörs inte av en timexport.
    expect(readFileSync(join(out, ".last-full"), "utf8")).toBe(`${BASE}\n`);
    expect(statSync(join(out, ".last-full")).mtimeMs).toBe(markerMtime);
  });

  it("ett tillägg utan ändrade filer är ett giltigt arkiv utan filer", () => {
    writeFileSync(join(content, "gammal.pdf"), "gammal");
    age(join(content, "gammal.pdf"), 3 * HOUR_S);
    age(join(content, ".git"), 3 * HOUR_S);
    age(content, 3 * HOUR_S);
    withBase(2 * HOUR_S);

    const r = run(["--hourly"]);
    expect(r.status, r.out).toBe(0);
    const archive = join(out, exports().find((n) => n.endsWith("-hourly.tar.age")) ?? "");
    const diffPath = join(root, "diff.tar.gz");
    writeFileSync(diffPath, spawnSync("tar", ["-xOf", archive, "./content-diff.tar.gz"]).stdout);
    expect(listTar(diffPath, true).filter((m) => !m.endsWith("/"))).toEqual([]);
  });
});

describe("backup-export.sh: gallring per sort", () => {
  /** En export med checksumma, `ageS` sekunder gammal. */
  function old(name: string, ageS: number): void {
    for (const f of [name, `${name}.sha256`]) {
      writeFileSync(join(out, f), "x");
      age(join(out, f), ageS);
    }
  }

  it("timexporter efter AVA_EXPORT_KEEP_HOURLY_H, fulla efter 14 dagar", () => {
    old("ava-2026-01-01-0300.tar.age", 15 * 24 * HOUR_S);
    old("ava-2026-01-05-0300.tar.age", 10 * 24 * HOUR_S);
    old("ava-2026-01-10-0100-hourly.tar.age", 49 * HOUR_S);
    old("ava-2026-01-10-0200-hourly.tar.age", 47 * HOUR_S);
    expect(run().status).toBe(0);
    const left = readdirSync(out);
    expect(left).not.toContain("ava-2026-01-01-0300.tar.age");
    expect(left).not.toContain("ava-2026-01-01-0300.tar.age.sha256");
    expect(left).toContain("ava-2026-01-05-0300.tar.age");
    expect(left).not.toContain("ava-2026-01-10-0100-hourly.tar.age");
    expect(left).not.toContain("ava-2026-01-10-0100-hourly.tar.age.sha256");
    expect(left).toContain("ava-2026-01-10-0200-hourly.tar.age.sha256");
  });

  it("den fulla gallringen tar inga timexporter, och timgallringen inga fulla", () => {
    old("ava-2026-01-01-0100-hourly.tar.age", 15 * 24 * HOUR_S);
    old("ava-2026-01-05-0300.tar.age", 3 * 24 * HOUR_S);
    const r = run([], { AVA_EXPORT_KEEP_HOURLY_H: "1000" });
    expect(r.status, r.out).toBe(0);
    const left = readdirSync(out);
    expect(left).toContain("ava-2026-01-01-0100-hourly.tar.age");
    expect(left).toContain("ava-2026-01-05-0300.tar.age");
  });
});
