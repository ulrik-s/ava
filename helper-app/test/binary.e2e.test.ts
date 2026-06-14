/**
 * E2E mot den FAKTISKT shippade artefakten (#99, #102): kompilerar binären
 * med `bun build --compile` och kör den. Verifierar HTTP-API:t OCH att
 * HTTPS serveras med ett lokalt genererat cert (ADR 0006).
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:tls";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { HELPER_PING_PREFIX } from "@/lib/shared/helper/protocol";
import { resolveDataDir } from "../src/paths.ts";
import { currentPlatform } from "../src/platform/runtime.ts";

const VERSION = "helper-v9.9.9-e2e";
const HTTP_PORT = 48799;
const HTTPS_PORT = 48798;
const HTTP_BASE = `http://127.0.0.1:${HTTP_PORT}`;
const HTTPS_BASE = `https://localhost:${HTTPS_PORT}`;

let dir: string;
let bin: string;
let server: ChildProcess | undefined;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ava-helper-e2e-"));
  bin = join(dir, "ava-helper");
  const build = spawnSync(
    process.execPath,
    ["build", "src/main.ts", "--compile", "--define", `__AVA_HELPER_VERSION__="${VERSION}"`, "--outfile", bin],
    { encoding: "utf8" },
  );
  if (build.status !== 0) {
    throw new Error(`bun build --compile misslyckades (${build.status}): ${build.stderr ?? ""}`);
  }
  // Egen HOME/data-dir så cert + logg hamnar i temp (ingen pollution).
  server = spawn(bin, [], {
    stdio: "ignore",
    env: {
      ...process.env,
      AVA_HELPER_PORT: String(HTTP_PORT),
      AVA_HELPER_HTTPS_PORT: String(HTTPS_PORT),
      HOME: dir,
      XDG_DATA_HOME: dir,
      LOCALAPPDATA: dir,
    },
  });
  await waitForHttp();
}, 60_000);

afterAll(async () => {
  server?.kill("SIGKILL");
  await rm(dir, { recursive: true, force: true });
});

async function waitForHttp(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const r = await fetch(`${HTTP_BASE}/ping`, { signal: AbortSignal.timeout(500) });
      if (r.ok) return;
    } catch {
      /* inte uppe än */
    }
    if (Date.now() > deadline) throw new Error("kompilerad binär svarade aldrig på /ping");
    await new Promise((res) => setTimeout(res, 100));
  }
}

/** CN i certet HTTPS-servern presenterar (utan att validera kedjan). */
function peerCertCommonName(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "localhost", port, servername: "localhost", rejectUnauthorized: false }, () => {
      const subject: unknown = socket.getPeerCertificate().subject;
      socket.end();
      const cn = subject !== null && typeof subject === "object" && "CN" in subject
        ? String((subject as { CN?: unknown }).CN ?? "")
        : "";
      resolve(cn);
    });
    socket.setTimeout(5_000, () => socket.destroy(new Error("TLS-timeout")));
    socket.on("error", reject);
  });
}

describe("kompilerad binär (--compile)", () => {
  test("--version skriver ut den inbakade versionen", () => {
    const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(VERSION);
  });

  test("HTTP: /ping, /version, CORS och /check-update", async () => {
    const ping = await fetch(`${HTTP_BASE}/ping`);
    expect(ping.status).toBe(200);
    expect((await ping.text()).trim()).toBe(`${HELPER_PING_PREFIX} ${VERSION}`);

    const version = await fetch(`${HTTP_BASE}/version`);
    expect(((await version.json()) as { current: string }).current).toBe(VERSION);

    const cors = await fetch(`${HTTP_BASE}/ping`, {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:3000" },
    });
    expect(cors.status).toBe(204);
    expect(cors.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");

    const upd = await fetch(`${HTTP_BASE}/check-update`, { method: "POST" });
    expect(upd.status).toBe(202);
  });

  test("HTTPS: leaf-certet kedjar till helperns lokala CA (full validering)", async () => {
    // Läs helperns egen CA ur data-dir (temp-HOME) och använd som trust-anchor
    // → bevisar att leaf:et faktiskt validerar mot CA:n (inte bara att TLS svarar).
    const dataRoot = resolveDataDir(currentPlatform(), dir, { localAppData: dir, xdgDataHome: dir });
    if (dataRoot === null) throw new Error("kunde inte härleda data-dir");
    const ca = await readFile(join(dataRoot, "tls", "ca.pem"), "utf8");

    const ping = await fetch(`${HTTPS_BASE}/ping`, { tls: { ca } } as RequestInit);
    expect(ping.status).toBe(200);
    expect((await ping.text()).trim()).toBe(`${HELPER_PING_PREFIX} ${VERSION}`);
    expect(await peerCertCommonName(HTTPS_PORT)).toBe("localhost");
  });

  test("HTTPS: avvisas utan helperns CA (självsignerad → ej betrodd)", async () => {
    // Utan CA i trust-store ska kedje-valideringen fela (mixed-trust-skydd).
    let rejected = false;
    try {
      await fetch(`${HTTPS_BASE}/ping`);
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });
});
