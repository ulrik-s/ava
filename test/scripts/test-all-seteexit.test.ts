/**
 * Regressionsvakt för #143: `tooling/scripts/test-all.sh` får INTE rapportera
 * grönt om ett steg fallerar.
 *
 * Buggen: `cmd && ok "label"` under `set -e` aborterar inte scriptet när `cmd`
 * fallerar (bash undertrycker exit-on-error för kommandon i en &&-lista utom
 * det sista). Steget passerade tyst → falsk "Allt grönt"/exit 0.
 *
 * Testet (a) statiskt: varje `&& ok "`-rad måste ha en `|| fail`-vakt (dvs run-
 * helpern, inte det bara mönstret), och (b) semantiskt: helper-mönstret gör att
 * ett fallerat steg ger exit ≠ 0.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest-compat";

const SCRIPT = resolve(__dirname, "..", "..", "tooling", "scripts", "test-all.sh");

describe("test-all.sh — set -e-säkerhet (#143)", () => {
  const src = readFileSync(SCRIPT, "utf8");

  it("kör under `set -euo pipefail`", () => {
    expect(src).toMatch(/set -euo pipefail/);
  });

  it("inget steg använder bara `&& ok` utan `|| fail`-vakt", () => {
    const offenders = src
      .split("\n")
      .filter((line) => !line.trim().startsWith("#")) // hoppa kommentarer
      .filter((line) => /&&\s*ok\s+"/.test(line))
      .filter((line) => !/\|\|\s*fail/.test(line));
    expect(offenders).toEqual([]);
  });

  it("ett fallerat steg ger exit ≠ 0 (run-helpern aborterar)", () => {
    // Replikerar run-helperns kontrakt: `false`-steg → script-exit 1.
    const harness = `
      set -euo pipefail
      ok() { :; }; fail() { exit 1; }
      run() { local label="$1"; shift; "$@" && ok "$label" || fail "$label"; }
      run "ok-steg" true
      run "fel-steg" false
      echo "SKA INTE NÅS"
    `;
    let exitCode = 0;
    let stdout = "";
    try {
      stdout = execFileSync("bash", ["-c", harness], { encoding: "utf8" });
    } catch (e) {
      exitCode = (e as { status?: number }).status ?? 1;
      stdout = (e as { stdout?: string }).stdout ?? "";
    }
    expect(exitCode).not.toBe(0);
    expect(stdout).not.toContain("SKA INTE NÅS");
  });

  it("ett lyckat steg fortsätter (exit 0)", () => {
    const harness = `
      set -euo pipefail
      ok() { :; }; fail() { exit 1; }
      run() { local label="$1"; shift; "$@" && ok "$label" || fail "$label"; }
      run "ok-steg" true
      echo "NÅDDE SLUTET"
    `;
    const stdout = execFileSync("bash", ["-c", harness], { encoding: "utf8" });
    expect(stdout).toContain("NÅDDE SLUTET");
  });
});
