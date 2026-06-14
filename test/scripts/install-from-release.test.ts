/**
 * Test för bootstrap-installern (#325). Kör scriptet i --dry-run (ingen curl/
 * docker) och verifierar planen + arg-validering. Bash-I/O-stegen körs aldrig.
 */

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, it, expect } from "vitest-compat";

const SCRIPT = join(process.cwd(), "tooling/scripts/install-from-release.sh");

function run(args: string[]): { status: number; out: string } {
  const r = spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8" });
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("install-from-release.sh --dry-run", () => {
  it("planen innehåller käll-tarball-URL:en för taggen + install-kommandot", () => {
    const { status, out } = run(["--version", "v1.2.3", "--config", "./install.json", "--dir", "/srv/ava", "--dry-run"]);
    expect(status).toBe(0);
    expect(out).toContain("https://github.com/ulrik-s/ava/archive/refs/tags/v1.2.3.tar.gz");
    expect(out).toContain("bun tooling/scripts/install-server.ts --config ./install.json --start");
    expect(out).toContain("/srv/ava");
  });

  it("default install-dir = ava-<tag> när --dir utelämnas", () => {
    const { out } = run(["--version", "v9.9.9", "--config", "x.json", "--dry-run"]);
    expect(out).toContain("ava-v9.9.9");
  });

  it("respekterar --repo-override i URL:en", () => {
    const { out } = run(["--version", "v1.0.0", "--config", "x.json", "--repo", "acme/ava-fork", "--dry-run"]);
    expect(out).toContain("https://github.com/acme/ava-fork/archive/refs/tags/v1.0.0.tar.gz");
  });
});

describe("install-from-release.sh arg-validering", () => {
  it("saknat --config → exit 1 + tydligt fel", () => {
    const { status, out } = run(["--version", "v1.2.3", "--dry-run"]);
    expect(status).toBe(1);
    expect(out).toMatch(/--config.*krävs/);
  });

  it("okänt argument → exit 1", () => {
    const { status, out } = run(["--frobnicate", "--config", "x.json", "--dry-run"]);
    expect(status).toBe(1);
    expect(out).toMatch(/okänt argument/);
  });

  it("--help → exit 0 + användning", () => {
    const { status, out } = run(["--help"]);
    expect(status).toBe(0);
    expect(out).toMatch(/ett-svep-installer/);
    expect(out).toContain("--version");
  });
});
