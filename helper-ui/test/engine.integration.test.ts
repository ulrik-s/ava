/**
 * Integration: boota motorn IN-PROCESS (startEngine) mot en temp-data-dir +
 * lediga portar och träffa HTTP-endpoints på riktigt (ADR 0030). Det här täcker
 * server-wiringen som unit-testerna inte når — och bevisar att motorn körs
 * headless (utan Electron/display), vilket är hela poängen med konsolideringen.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import superjson from "superjson";

import { startEngine, type EngineHandle, type EngineOpts } from "../src/engine/main.ts";

const dirs: string[] = [];
const engines: EngineHandle[] = [];

afterAll(async () => {
  for (const e of engines) e.stop();
  await new Promise((r) => setTimeout(r, 50)); // låt servrarna stänga
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function boot(opts: Pick<EngineOpts, "confirmOrigin" | "logDir"> = {}): Promise<{ base: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "ava-engine-"));
  dirs.push(dir);
  // Lediga högportar (deterministiskt nog för test; undviker default 48761).
  const port = 49000 + Math.floor((dirs.length * 7) % 500);
  // logDir: null → rör inte användarens riktiga loggkatalog.
  const engine = startEngine({ port, httpsPort: port + 1, dataDir: dir, logDir: null, ...opts });
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
      headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ oidcIssuer: "http://localhost:8089/realms/ava" }),
    });
    expect(r.status).toBe(200);
    const written = JSON.parse(await readFile(join(dir, "helper-config.json"), "utf8"));
    expect(written).toMatchObject({ oidcIssuer: "http://localhost:8089/realms/ava" });
  });

  test("motorn loggar till fil — också i Electron-skalet, som bara anropar startEngine (#1161)", async () => {
    const logDir = await mkdtemp(join(tmpdir(), "ava-engine-log-"));
    dirs.push(logDir);
    const { base } = await boot({ logDir });
    await fetch(`${base}/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ oidcIssuer: "https://login.example/v2.0" }),
    });
    const text = await readFile(join(logDir, "helper.log"), "utf8");
    expect(text).toMatch(/ava-helper .* startar/);
    expect(text).toContain("config: konfigurerad av web-appen (issuer https://login.example/v2.0)");
  });

  test("okänd https-webbplats → användaren tillfrågas; Tillåt → släpps in + sparas (#1149)", async () => {
    const asked: string[] = [];
    const { base, dir } = await boot({ confirmOrigin: async (o) => { asked.push(o); return true; } });
    const ping = () => fetch(`${base}/ping`, { headers: { Origin: "https://ava-crm.io" } });
    expect((await ping()).headers.get("Access-Control-Allow-Origin")).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(asked).toEqual(["https://ava-crm.io"]);
    expect((await ping()).headers.get("Access-Control-Allow-Origin")).toBe("https://ava-crm.io");
    expect(JSON.parse(await readFile(join(dir, "allowed-origins.json"), "utf8"))).toEqual(["https://ava-crm.io"]);
  });

  test("CORS: tillåten origin får Access-Control-Allow-Origin", async () => {
    const { base } = await boot();
    const r = await fetch(`${base}/ping`, { headers: { Origin: "http://localhost:3000" } });
    expect(r.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });

  test("okänd route → 404", async () => {
    const { base } = await boot();
    expect((await fetch(`${base}/nope`, { headers: { Origin: "http://localhost:3000" } })).status).toBe(404);
  });

  test("okänd webbsida når inte /config — 403 och ingen config skrivs (#1448)", async () => {
    const { base, dir } = await boot();
    const r = await fetch(`${base}/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.github.io" },
      body: JSON.stringify({ oidcIssuer: "https://evil.example/" }),
    });
    expect(r.status).toBe(403);
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
    await expect(readFile(join(dir, "helper-config.json"), "utf8")).rejects.toThrow();
  });

  test("ett text/plain-anrop (utan preflight) tas inte emot som JSON (#1448)", async () => {
    const { base, dir } = await boot();
    const r = await fetch(`${base}/config`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", Origin: "http://localhost:3000" },
      body: JSON.stringify({ oidcIssuer: "https://evil.example/" }),
    });
    expect(r.status).toBe(400);
    await expect(readFile(join(dir, "helper-config.json"), "utf8")).rejects.toThrow();
  });

  test("stop() stänger servern (anslutning vägras därefter)", async () => {
    const { base } = await boot();
    const e = engines[engines.length - 1]!;
    e.stop();
    await new Promise((r) => setTimeout(r, 50));
    await expect(fetch(`${base}/ping`, { signal: AbortSignal.timeout(500) })).rejects.toThrow();
  });
});

/**
 * Acceptans (#1838): helperns token följer bara med till godkända AVA-servrar,
 * genom den riktiga kopplingen i `startEngine` (kö, `/open` och `/content`
 * delar samma grindade token).
 */
describe("startEngine — helperns token bara till godkända servrar (#1838)", () => {
  /** Motorn med en issuer i helper-config.json och en giltig token-fil. */
  async function bootLoggedIn(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "ava-engine-tok-"));
    dirs.push(dir);
    await writeFile(join(dir, "helper-config.json"), JSON.stringify({ oidcIssuer: "http://localhost:8089/realms/ava" }));
    const tokenFile = join(dir, "token.json");
    await writeFile(tokenFile, JSON.stringify({ accessToken: "TOK", expiresAt: Date.now() + 3_600_000 }));
    const port = 49000 + Math.floor((dirs.length * 7) % 500);
    const before = process.env.AVA_HELPER_TOKEN_FILE;
    process.env.AVA_HELPER_TOKEN_FILE = tokenFile;
    try {
      engines.push(startEngine({ port, httpsPort: port + 1, dataDir: dir, logDir: null }));
    } finally {
      if (before === undefined) delete process.env.AVA_HELPER_TOKEN_FILE;
      else process.env.AVA_HELPER_TOKEN_FILE = before;
    }
    await new Promise((r) => setTimeout(r, 150));
    return `http://127.0.0.1:${port}`;
  }

  /** Kör `fn` med en fetch-stubb: anrop till motorn går igenom, allt annat spelas in. */
  async function withStub(base: string, fn: () => Promise<void>): Promise<Map<string, string | null>> {
    const seen = new Map<string, string | null>();
    const real = globalThis.fetch;
    const stub = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith(base)) return real(input, init);
      seen.set(new URL(url).origin, new Headers(init?.headers).get("authorization"));
      const data = { contentBase64: Buffer.from("PDF").toString("base64"), mimeType: "application/pdf", fileName: "x.pdf", version: 1 };
      return new Response(JSON.stringify([{ result: { data: superjson.serialize(data) } }]), {
        status: 200, headers: { "content-type": "application/json" },
      });
    };
    globalThis.fetch = Object.assign(stub, { preconnect: real.preconnect });
    try {
      await fn();
    } finally {
      globalThis.fetch = real;
    }
    return seen;
  }

  const content = (base: string, body: unknown): Promise<Response> =>
    fetch(`${base}/content`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify(body),
    });

  test("trpcUrl på en annan värd och en downloadUrl där får ingen token; localhost får Bearer", async () => {
    const base = await bootLoggedIn();
    const seen = await withStub(base, async () => {
      expect((await content(base, { document: { id: "d-annan", trpcUrl: "https://annan.example/api/trpc" } })).status).toBe(200);
      expect((await content(base, { document: { id: "d-lokal", trpcUrl: "http://localhost:8080/api/trpc" } })).status).toBe(200);
    });
    expect(seen.get("https://annan.example")).toBeNull();
    expect(seen.get("http://localhost:8080")).toBe("Bearer TOK");

    const seenUrl = await withStub(base, async () => {
      expect((await content(base, { downloadUrl: "https://annan.example/fil.pdf" })).status).toBe(200);
    });
    expect(seenUrl.get("https://annan.example")).toBeNull();
  });
});
