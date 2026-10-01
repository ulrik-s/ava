/**
 * `restore-db.sh` (#1079, #1360) — ordningen i återställningen.
 *
 * Kör det riktiga skriptet med en fejkad `docker` på PATH som loggar varje
 * anrop (och det som skickas på stdin). Det som skyddas:
 *   - server-first stoppas före och startas efter,
 *   - dumpen läses in i en återskapad databas,
 *   - SYNKEPOKEN byts efter dumpen och före start (#1360): annars pullar
 *     klienterna vidare från cursorer som hör till en historik som inte finns
 *     längre, och missar tyst ändringar som får återanvända nummer.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest-compat";

const SCRIPT = join(process.cwd(), "tooling/scripts/restore-db.sh");

let root = "";
let log = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ava-restore-"));
  log = join(root, "docker.log");
  const bin = join(root, "bin");
  mkdirSync(bin);
  // docker: logga argumenten och stdin; /readyz svarar ok.
  writeFileSync(join(bin, "docker"), `#!/usr/bin/env bash
echo "ARGS: $*" >> "$DOCKER_LOG"
case "$*" in
  *wget*) echo '{"status":"ok"}' ;;
  *) cat >> "$DOCKER_LOG" ;;
esac
`);
  chmodSync(join(bin, "docker"), 0o755);
  writeFileSync(join(root, "ava.sql.gz"), gzipSync("-- DUMPENS INNEHÅLL\n"));
});

afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function run(): { status: number; out: string } {
  const r = spawnSync("bash", [SCRIPT, join(root, "ava.sql.gz")], {
    encoding: "utf8",
    input: "",
    env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`, DOCKER_LOG: log, AVA_RESTORE_YES: "1" },
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("restore-db.sh", () => {
  it("stoppar, återskapar, läser in dumpen, byter synkepok och startar — i den ordningen", () => {
    const { status, out } = run();
    expect(status, out).toBe(0);
    expect(out).toMatch(/Byter synkepok/);
    const text = readFileSync(log, "utf8");
    const at = (needle: string): number => {
      const i = text.indexOf(needle);
      expect(i, `${needle} saknas i:\n${text}`).toBeGreaterThanOrEqual(0);
      return i;
    };
    const order = [
      at("stop server-first"),
      at("DROP DATABASE"),
      at("-- DUMPENS INNEHÅLL"),
      at("ON CONFLICT (singleton) DO UPDATE SET epoch = gen_random_uuid()"),
      at("start server-first"),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("satsen som skickas är den delade rotate-sync-epoch.sql", () => {
    run();
    expect(readFileSync(log, "utf8")).toContain(readFileSync("tooling/db/rotate-sync-epoch.sql", "utf8"));
  });
});
