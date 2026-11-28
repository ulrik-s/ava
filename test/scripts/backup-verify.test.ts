/**
 * `backup-verify.sh` (#1254) — felen som ska stoppa FÖRE docker.
 *
 * Hela vägen (dekryptera → engångs-Postgres → kontrollerna) körs i CI av
 * återställningsövningen (`restore-drill.sh`, jobbet "Återställningsövning")
 * mot en riktig krypterad export, full och timexport. Här: att felaktig
 * användning ger ett tydligt fel och rätt exit-kod, utan att någon container
 * startas.
 *
 * Timexporten (#1897, ADR 0039): basen ska ligga bredvid, och `BASE` ska ha
 * de fulla exporternas namnform. `age` och `docker` är fejkade på PATH (arkiven
 * är okrypterade tar-filer, som i `backup-pull.test.ts`); docker-fejken loggar
 * varje anrop och misslyckas, så testet ser om en container hade startat.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest-compat";

const SCRIPT = join(process.cwd(), "tooling/scripts/backup-verify.sh");
let dir = "";

function run(args: string[], env: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ava-verify-"));
  writeFileSync(join(dir, "a.tar.age"), "x");
  writeFileSync(join(dir, "age.key"), "AGE-SECRET-KEY-TEST");
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("backup-verify.sh — användning", () => {
  it("utan argument → användning, exit 2", () => {
    const { status, out } = run([]);
    expect(status).toBe(2);
    expect(out).toMatch(/Användning/);
  });

  it("saknat arkiv → tydligt fel, exit 1", () => {
    const { status, out } = run([join(dir, "finns-inte.tar.age"), join(dir, "age.key")]);
    expect(status).toBe(1);
    expect(out).toMatch(/arkivet finns inte/);
  });

  it("saknad nyckel → tydligt fel, exit 1", () => {
    const { status, out } = run([join(dir, "a.tar.age"), join(dir, "saknas.key")]);
    expect(status).toBe(1);
    expect(out).toMatch(/nyckeln finns inte/);
  });

  it("--expect-matter utan ärendenummer → användning, exit 2", () => {
    const { status, out } = run([join(dir, "a.tar.age"), join(dir, "age.key"), "--expect-matter"]);
    expect(status).toBe(2);
    expect(out).toMatch(/Användning/);
  });
});

describe("backup-verify.sh — timexporten (#1897)", () => {
  const BASE = "ava-2026-09-29-0300.tar.age";
  const HOURLY = "ava-2026-09-29-1415-hourly.tar.age";
  let bin = "";
  let dockerLog = "";

  function shim(name: string, body: string): void {
    const p = join(bin, name);
    writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(p, 0o755);
  }

  /** Ett "arkiv" som backup-export.sh gör det: filerna, SHA256SUMS över dem, i en tar. */
  function makeArchive(name: string, files: Record<string, string>): void {
    const stage = join(dir, `stage-${name}`);
    mkdirSync(stage);
    for (const [f, body] of Object.entries(files)) writeFileSync(join(stage, f), body);
    const listed = Object.keys(files).map((f) => `./${f}`).join(" ");
    spawnSync("bash", ["-c", `cd "${stage}" && sha256sum ${listed} > SHA256SUMS && tar -cf "${join(dir, name)}" .`]);
  }

  function makeHourly(base: string): void {
    makeArchive(HOURLY, { "ava-2026-09-29-1415.sql.gz": "dump", "content-diff.tar.gz": "diff", BASE: `${base}\n` });
  }

  /** Startade engångs-Postgres (`docker run -d`)? Städningen (`docker rm`) räknas inte. */
  function containerStarted(): boolean {
    return existsSync(dockerLog) && readFileSync(dockerLog, "utf8").split("\n").some((l) => l.startsWith("run -d"));
  }

  function runVerify(archive: string): { status: number; out: string } {
    return run([join(dir, archive), join(dir, "age.key")], { PATH: `${bin}:${process.env.PATH ?? ""}`, DOCKER_LOG: dockerLog });
  }

  beforeEach(() => {
    bin = join(dir, "bin");
    mkdirSync(bin);
    dockerLog = join(dir, "docker.log");
    // age -d -i KEY FILE → arkiven är redan okrypterade.
    shim("age", 'cat "${@: -1}"');
    shim("docker", 'echo "$*" >> "$DOCKER_LOG"; exit 1');
  });

  it("utan basen bredvid → tydligt fel som nämner basen, och ingen container startar", () => {
    makeHourly(BASE);
    const { status, out } = runVerify(HOURLY);
    expect(status).toBe(1);
    expect(out).toContain(`basen ${BASE} saknas bredvid timexporten`);
    expect(containerStarted()).toBe(false);
  });

  it.each(["../hemlig.tar.age", "ava-2026-09-29-1415-hourly.tar.age", ""])("ogiltigt BASE ('%s') → tydligt fel innan basen öppnas", (base) => {
    makeHourly(base);
    const { status, out } = runVerify(HOURLY);
    expect(status).toBe(1);
    expect(out).toMatch(/BASE är inte en full export/);
    expect(out).not.toMatch(/Basen:/);
    expect(containerStarted()).toBe(false);
  });

  it("med basen bredvid: båda arkivens checksummor kontrolleras och basens namn skrivs ut", () => {
    makeHourly(BASE);
    makeArchive(BASE, { "ava-2026-09-29-0300.sql.gz": "dump", "content.tar.gz": "full" });
    const { out } = runVerify(HOURLY);
    expect(out).toContain(`Basen: ${BASE}`);
    expect(out).toContain("✓ checksummor ok");
    // Nästa steg är engångs-Postgres: docker-fejken startar den (och misslyckas).
    expect(containerStarted()).toBe(true);
  });

  it("en bas med trasig checksumma → fel som nämner basen", () => {
    makeHourly(BASE);
    makeArchive(BASE, { "ava-2026-09-29-0300.sql.gz": "dump", "content.tar.gz": "full" });
    spawnSync("bash", ["-c", `cd "${dir}" && mkdir trasig && tar -C trasig -xf ${BASE} && echo ändrad > trasig/content.tar.gz && tar -C trasig -cf ${BASE} .`]);
    const { status, out } = runVerify(HOURLY);
    expect(status).toBe(1);
    expect(out).toContain(`checksummorna i ${BASE} stämmer inte`);
    expect(containerStarted()).toBe(false);
  });

  it("en bas utan dokumentarkivet → tydligt fel", () => {
    makeHourly(BASE);
    makeArchive(BASE, { "ava-2026-09-29-0300.sql.gz": "dump" });
    const { status, out } = runVerify(HOURLY);
    expect(status).toBe(1);
    expect(out).toContain(`basen ${BASE} saknar dokumenten (content.tar.gz)`);
  });

  it("en timexport utan tillägget → tydligt fel", () => {
    makeArchive(HOURLY, { "ava-2026-09-29-1415.sql.gz": "dump", BASE: `${BASE}\n` });
    const { status, out } = runVerify(HOURLY);
    expect(status).toBe(1);
    expect(out).toContain("timexporten saknar dokumenttillägget (content-diff.tar.gz)");
  });

  it("ett fullt arkiv tas emot som i dag: inget BASE behövs, och nästa steg är engångs-Postgres", () => {
    makeArchive(BASE, { "ava-2026-09-29-0300.sql.gz": "dump", "content.tar.gz": "full" });
    const { out } = runVerify(BASE);
    expect(out).not.toMatch(/Basen:/);
    expect(out).toContain("✓ checksummor ok");
    expect(containerStarted()).toBe(true);
  });

  it("ett fullt arkiv utan dokumentarkivet → samma fel som förut", () => {
    makeArchive(BASE, { "ava-2026-09-29-0300.sql.gz": "dump" });
    const { status, out } = runVerify(BASE);
    expect(status).toBe(1);
    expect(out).toContain("arkivet saknar dokumenten (content.tar.gz)");
  });
});
