/**
 * `build-demo.sh` — demo- och prod-varianten av den statiska exporten (#1352).
 *
 * Kör det RIKTIGA skriptet i en kopia av repo-layouten, med falska `bunx`,
 * `bun` och `docker` på PATH som loggar varje anrop:
 *   - demo (default): seed, datamanifest, demo-seed.json och .nojekyll — GH
 *     Pages-demon behöver dem,
 *   - server (prod): inget av det, och kontrollen att `out/` saknar demodata
 *     körs sist och fäller bygget,
 *   - ett okänt mål avbryter innan något byggs.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest-compat";

const SCRIPT = "tooling/scripts/build-demo.sh";
const DEMO_DATA_STEPS = ["build-demo-repo.ts", "generate-demo-manifest.ts", "generate-demo-seed.ts"];

let root = "";
let bin = "";
let log = "";

function write(path: string, content: string, mode = 0o644): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, mode);
}

// `next build` → ett minimalt out/ (och målet som bygget såg).
const FAKE_BUNX = `#!/usr/bin/env bash
echo "bunx $* AVA_BUILD_TARGET=\${AVA_BUILD_TARGET:-} DEMO_BUILD=\${DEMO_BUILD:-}" >> "$FAKE_LOG"
mkdir -p out && echo skal > out/index.html
`;

const FAKE_BUN = `#!/usr/bin/env bash
echo "bun $*" >> "$FAKE_LOG"
case "$*" in
  *check-no-demo-data.ts*) [ -z "\${FAKE_CHECK_FAIL:-}" ] || exit 1 ;;
esac
`;

const FAKE_DOCKER = `#!/usr/bin/env bash
echo "docker $*" >> "$FAKE_LOG"
`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ava-build-demo-"));
  bin = join(root, "bin");
  log = join(root, "log");
  mkdirSync(join(root, "src/app"), { recursive: true });
  mkdirSync(dirname(join(root, SCRIPT)), { recursive: true });
  copyFileSync(join(process.cwd(), SCRIPT), join(root, SCRIPT));
  write(join(bin, "bunx"), FAKE_BUNX, 0o755);
  write(join(bin, "bun"), FAKE_BUN, 0o755);
  write(join(bin, "docker"), FAKE_DOCKER, 0o755);
});

afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function build(env: Record<string, string> = {}): { status: number; out: string; calls: string[] } {
  writeFileSync(log, "");
  const r = spawnSync("bash", [join(root, SCRIPT)], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, FAKE_LOG: log, AVA_BUILD_TARGET: "", ...env },
  });
  const calls = readFileSync(log, "utf8").split("\n").filter(Boolean);
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, calls };
}

const ran = (calls: string[], needle: string): boolean => calls.some((c) => c.includes(needle));

describe("build-demo.sh — demo (default, GH Pages)", () => {
  it("seedar demodata, skriver manifest + demo-seed.json och .nojekyll", () => {
    const { status, out, calls } = build();
    expect(status, out).toBe(0);
    expect(ran(calls, "next build AVA_BUILD_TARGET=demo DEMO_BUILD=1")).toBe(true);
    for (const step of DEMO_DATA_STEPS) expect(ran(calls, step), step).toBe(true);
    expect(existsSync(join(root, "out/.nojekyll"))).toBe(true);
    expect(ran(calls, "check-no-demo-data.ts")).toBe(false);
    expect(ran(calls, "build-service-worker.ts")).toBe(true);
    expect(out).toContain("PDF/DOCX");
  });
});

describe("build-demo.sh — server (prod, #1352)", () => {
  it("bygger skalet utan demodata och kontrollerar out/ sist", () => {
    const { status, out, calls } = build({ AVA_BUILD_TARGET: "server" });
    expect(status, out).toBe(0);
    expect(ran(calls, "next build AVA_BUILD_TARGET=server DEMO_BUILD=1")).toBe(true);
    for (const step of DEMO_DATA_STEPS) expect(ran(calls, step), step).toBe(false);
    expect(existsSync(join(root, "out/.nojekyll"))).toBe(false);
    const check = calls.findIndex((c) => c.includes(`check-no-demo-data.ts ${join(root, "out")}`));
    expect(check).toBeGreaterThan(calls.findIndex((c) => c.includes("build-service-worker.ts")));
    expect(out).toContain("ingen demodata");
    expect(out).not.toContain("PDF/DOCX");
  });

  it("fäller bygget när kontrollen hittar demodata", () => {
    const { status } = build({ AVA_BUILD_TARGET: "server", FAKE_CHECK_FAIL: "1" });
    expect(status).not.toBe(0);
  });
});

describe("build-demo.sh — okänt mål", () => {
  it("avbryter innan något byggs", () => {
    const { status, out, calls } = build({ AVA_BUILD_TARGET: "prod" });
    expect(status).toBe(2);
    expect(out).toContain("okänt AVA_BUILD_TARGET=prod");
    expect(calls).toEqual([]);
  });
});
