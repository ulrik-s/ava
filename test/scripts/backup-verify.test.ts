/**
 * `backup-verify.sh` (#1254) — felen som ska stoppa FÖRE docker.
 *
 * Hela vägen (dekryptera → engångs-Postgres → kontrollerna) körs i CI av
 * återställningsövningen (`restore-drill.sh`, jobbet "Återställningsövning")
 * mot en riktig krypterad export. Här: att felaktig användning ger ett tydligt
 * fel och rätt exit-kod, utan att någon container startas.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest-compat";

const SCRIPT = join(process.cwd(), "tooling/scripts/backup-verify.sh");
let dir = "";

function run(args: string[]): { status: number; out: string } {
  const r = spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8" });
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
