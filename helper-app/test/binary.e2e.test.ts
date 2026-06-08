/**
 * E2E mot den FAKTISKT shippade artefakten (#99): kompilerar binären med
 * `bun build --compile` och kör den. Källtesterna kör mot TS — det här
 * fångar sådant som bara går sönder i den kompilerade binären (versions-
 * injektion via --define, Bun.serve i compiled-kontext, embedded runtime).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HELPER_PING_PREFIX } from "@/lib/shared/helper/protocol";

const VERSION = "helper-v9.9.9-e2e";
const PORT = 48799; // ej default-porten → krockar inte med ev. riktig helper
const BASE = `http://127.0.0.1:${PORT}`;

let dir: string;
let bin: string;
let server: ChildProcess | undefined;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ava-helper-e2e-"));
  bin = join(dir, "ava-helper");
  // Kompilera för host-plattformen med inbakad version (process.execPath = bun).
  const build = spawnSync(
    process.execPath,
    ["build", "src/main.ts", "--compile", "--define", `__AVA_HELPER_VERSION__="${VERSION}"`, "--outfile", bin],
    { encoding: "utf8" },
  );
  if (build.status !== 0) {
    throw new Error(`bun build --compile misslyckades (${build.status}): ${build.stderr ?? ""}`);
  }
}, 60_000);

afterAll(async () => {
  server?.kill("SIGKILL");
  await rm(dir, { recursive: true, force: true });
});

async function waitForReady(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const r = await fetch(`${BASE}/ping`, { signal: AbortSignal.timeout(500) });
      if (r.ok) return;
    } catch {
      /* inte uppe än */
    }
    if (Date.now() > deadline) throw new Error("kompilerad binär svarade aldrig på /ping");
    await new Promise((res) => setTimeout(res, 100));
  }
}

describe("kompilerad binär (--compile)", () => {
  test("--version skriver ut den inbakade versionen", () => {
    const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(VERSION);
  });

  test("startar och serverar /ping, /version, CORS och /check-update", async () => {
    server = spawn(bin, [], { env: { ...process.env, AVA_HELPER_PORT: String(PORT) }, stdio: "ignore" });
    await waitForReady();

    const ping = await fetch(`${BASE}/ping`);
    expect(ping.status).toBe(200);
    expect((await ping.text()).trim()).toBe(`${HELPER_PING_PREFIX} ${VERSION}`);

    const version = await fetch(`${BASE}/version`);
    expect(((await version.json()) as { current: string }).current).toBe(VERSION);

    const cors = await fetch(`${BASE}/ping`, {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:3000" },
    });
    expect(cors.status).toBe(204);
    expect(cors.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");

    const upd = await fetch(`${BASE}/check-update`, { method: "POST" });
    expect(upd.status).toBe(202);
  }, 20_000);
});
