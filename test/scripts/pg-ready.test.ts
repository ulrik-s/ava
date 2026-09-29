/**
 * `wait_for_pg` (#1305) — väntan på engångs-Postgres i backup-verify.sh.
 *
 * CI fällde återställningsövningen på "engångs-Postgres startade inte" efter
 * 1,2 s, fast servern var uppe: vänteloopen såg `ready` lyckas och bröt, och
 * slutkontrollen körde `ready` en gång till utan omförsök. Två kapplöpningar
 * gör den andra körningen falsk, och båda återskapas här med en falsk `docker`:
 *
 * - `pg_isready` svarar bara en gång — servern startas om efter initdb.
 * - `docker logs` skriver mycket; `grep -q` stänger röret vid första träffen,
 *   `docker logs` får SIGPIPE, och under `pipefail` blir pipelinen falsk.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest-compat";

const LIB = join(process.cwd(), "tooling/scripts/lib/pg-ready.sh");
let dir = "";

/** En falsk `docker`: loggen och pg_isready enligt testets val. */
function fakeDocker(opts: { isreadyOk: number; logLines: number; initDone: boolean }): void {
  const script = `#!/usr/bin/env bash
case "$1" in
  logs)
    ${opts.initDone ? 'echo "PostgreSQL init process complete; ready for start up."' : ":"}
    for i in $(seq 1 ${opts.logLines}); do echo "LOG:  rad $i i en lång logg"; done ;;
  exec)
    n=$(cat "${dir}/isready" 2>/dev/null || echo 0); echo $((n + 1)) > "${dir}/isready"
    [ "$n" -lt ${opts.isreadyOk} ] ;;
esac
`;
  writeFileSync(join(dir, "docker"), script);
  chmodSync(join(dir, "docker"), 0o755);
}

function waitForPg(tries: number): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", `set -euo pipefail; source "${LIB}"; wait_for_pg c1 ${tries} 0`], {
    encoding: "utf8", env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ava-pgready-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("wait_for_pg (#1305)", () => {
  it("servern svarar en enda gång (omstart efter initdb) → räknas som uppe", () => {
    fakeDocker({ isreadyOk: 1, logLines: 5, initDone: true });
    expect(waitForPg(5).status).toBe(0);
  });

  it("lång logg (SIGPIPE i grep -q under pipefail) → hittar ändå raden", () => {
    fakeDocker({ isreadyOk: 99, logLines: 200_000, initDone: true });
    expect(waitForPg(3).status).toBe(0);
  });

  it("init blir aldrig klar → falskt efter alla försök", () => {
    fakeDocker({ isreadyOk: 99, logLines: 5, initDone: false });
    expect(waitForPg(3).status).not.toBe(0);
  });

  it("init klar men servern svarar aldrig → falskt", () => {
    fakeDocker({ isreadyOk: 0, logLines: 5, initDone: true });
    expect(waitForPg(3).status).not.toBe(0);
  });
});
