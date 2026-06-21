/**
 * Integration: boota motorn IN-PROCESS (startEngine) mot en temp-data-dir +
 * lediga portar och träffa HTTP-endpoints på riktigt (ADR 0030). Det här täcker
 * server-wiringen som unit-testerna inte når — och bevisar att motorn körs
 * headless (utan Electron/display), vilket är hela poängen med konsolideringen.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";

import { startEngine, type EngineHandle } from "../src/main.ts";

const dirs: string[] = [];
const engines: EngineHandle[] = [];

afterAll(async () => {
  for (const e of engines) e.stop();
  await new Promise((r) => setTimeout(r, 50)); // låt servrarna stänga
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function boot(): Promise<{ base: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "ava-engine-"));
  dirs.push(dir);
  // Lediga högportar (deterministiskt nog för test; undviker default 48761).
  const port = 49000 + Math.floor((dirs.length * 7) % 500);
  const engine = startEngine({ port, httpsPort: port + 1, dataDir: dir });
  engines.push(engine);
  await new Promise((r) => setTimeout(r, 150)); // låt servern binda
  return { base: `http://127.0.0.1:${port}`, dir };
}

describe("startEngine (in-process, headless)", () => {
  test("GET /ping → version", async () => {
    const { base } = await boot();
    const r = await fetch(`${base}/ping`);
    expect(await r.text()).toContain("ava-helper");
  });

  test("GET /status → tom kö initialt", async () => {
    const { base } = await boot();
    const r = await fetch(`${base}/status`);
    expect(await r.json()).toMatchObject({ pending: 0, conflict: 0, total: 0 });
  });

  test("POST /config skriver helper-config.json i data-dir", async () => {
    const { base, dir } = await boot();
    const r = await fetch(`${base}/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oidcIssuer: "http://localhost:8089/realms/ava" }),
    });
    expect(r.status).toBe(200);
    const written = JSON.parse(await readFile(join(dir, "helper-config.json"), "utf8"));
    expect(written).toMatchObject({ oidcIssuer: "http://localhost:8089/realms/ava" });
  });

  test("CORS: tillåten origin får Access-Control-Allow-Origin", async () => {
    const { base } = await boot();
    const r = await fetch(`${base}/ping`, { headers: { Origin: "http://localhost:3000" } });
    expect(r.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });

  test("okänd route → 404", async () => {
    const { base } = await boot();
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  test("stop() stänger servern (anslutning vägras därefter)", async () => {
    const { base } = await boot();
    const e = engines[engines.length - 1]!;
    e.stop();
    await new Promise((r) => setTimeout(r, 50));
    await expect(fetch(`${base}/ping`, { signal: AbortSignal.timeout(500) })).rejects.toThrow();
  });
});
