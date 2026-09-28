/**
 * `build-service-worker.ts` (#1240) — väljer vad som förcachas ur `out/` och
 * bakar en versionsstämplad `sw.js`.
 *
 * Reglerna som skyddas:
 *   - app-skalet (sidor utan id, deras RSC-payloads, `_next/static`, favicon)
 *     förcachas,
 *   - källkartor, seedade id-sidor och ALL data (.ava, demo-seed, dokument)
 *     gör det inte,
 *   - versionen byts när innehållet byts — och bara då.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it } from "vitest-compat";
import { buildServiceWorker, collectPrecache, precacheVersion } from "../../tooling/scripts/build-service-worker";

let out: string;

async function file(rel: string, body = rel): Promise<void> {
  const p = join(out, rel);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, body);
}

beforeEach(async () => {
  out = await mkdtemp(join(tmpdir(), "ava-sw-"));
  await file("index.html");
  await file("index.txt");
  await file("__next._tree.txt");
  await file("favicon.ico");
  await file("matters/index.html");
  await file("matters/index.txt");
  await file("matters/__next.matters.__PAGE__.txt");
  await file("matters/__shell__/index.html");
  await file("matters/__shell__/index.txt");
  await file("templates/__shell__/edit/index.html");
  await file("matters/0fb22dd8-566b-566e-9dfc-4238f1941b67/index.html");
  await file("matters/0fb22dd8-566b-566e-9dfc-4238f1941b67/index.txt");
  await file("_next/static/chunks/a.js");
  await file("_next/static/chunks/a.js.map");
  await file("_next/static/media/f.woff2");
  await file("_next/static/css/s.css");
  await file("404.html");
  await file("404/index.html");
  await file("_not-found/index.html");
  await file(".ava/meta.json");
  await file("demo-seed.json");
  await file("manifest.json");
  await file("matters/0fb22dd8-566b-566e-9dfc-4238f1941b67.json");
  await file("documents/content/x.pdf");
  await file("sw.js", "gammal kill-switch");
});

afterEach(async () => {
  await rm(out, { recursive: true, force: true });
});

describe("collectPrecache", () => {
  it("tar med app-skalet och bara det", async () => {
    expect(await collectPrecache(out)).toEqual([
      "/",
      "/__next._tree.txt",
      "/_next/static/chunks/a.js",
      "/_next/static/css/s.css",
      "/_next/static/media/f.woff2",
      "/favicon.ico",
      "/index.txt",
      "/matters/",
      "/matters/__next.matters.__PAGE__.txt",
      "/matters/__shell__/",
      "/matters/__shell__/index.txt",
      "/matters/index.txt",
      "/templates/__shell__/edit/",
    ]);
  });

  it("utesluter källkartor, id-sidor, 404-sidor, data och sw.js själv", async () => {
    const paths = await collectPrecache(out);
    for (const bad of [".map", "0fb22dd8", "/404", "_not-found", ".ava", "demo-seed", "manifest.json", "/documents/", "sw.js"]) {
      expect(paths.some((p) => p.includes(bad)), `${bad} ska inte förcachas`).toBe(false);
    }
  });

  it("tom/saknad out/ → tydligt fel i stället för en tom (oanvändbar) service worker", async () => {
    await expect(collectPrecache(join(out, "finns-inte"))).rejects.toThrow();
    const empty = await mkdtemp(join(tmpdir(), "ava-sw-empty-"));
    try {
      await expect(collectPrecache(empty)).rejects.toThrow(/index\.html/);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

describe("precacheVersion", () => {
  it("samma innehåll → samma version (ingen onödig uppdateringsfråga)", async () => {
    const paths = await collectPrecache(out);
    expect(await precacheVersion(out, paths)).toBe(await precacheVersion(out, paths));
    expect(await precacheVersion(out, paths)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("ändrat innehåll i en förcachad fil → ny version", async () => {
    const paths = await collectPrecache(out);
    const before = await precacheVersion(out, paths);
    await file("matters/index.html", "ny lista");
    expect(await precacheVersion(out, paths)).not.toBe(before);
  });

  it("ändrad data (inte app-skal) → samma version", async () => {
    const paths = await collectPrecache(out);
    const before = await precacheVersion(out, paths);
    await file("demo-seed.json", "annan seed");
    expect(await precacheVersion(out, paths)).toBe(before);
  });
});

describe("buildServiceWorker", () => {
  it("bundlingsfel → tydligt fel, och ingen halvbyggd sw.js", async () => {
    await expect(buildServiceWorker(out, join(out, "finns-inte.ts"))).rejects.toThrow(/bundling misslyckades/);
    expect(await readFile(join(out, "sw.js"), "utf8")).toBe("gammal kill-switch");
  });

  it("CLI:t skriver sw.js och rapporterar version och antal", async () => {
    const proc = Bun.spawn([process.execPath, "tooling/scripts/build-service-worker.ts", out], { stdout: "pipe", stderr: "pipe" });
    const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/version [0-9a-f]{16}, 13 filer förcachas/);
    expect(await readFile(join(out, "sw.js"), "utf8")).not.toContain("kill-switch");
  });

  it("utanför en service worker vägrar sw.js starta (i stället för att tyst göra fel)", async () => {
    await buildServiceWorker(out);
    const source = await readFile(join(out, "sw.js"), "utf8");
    expect(() => runInNewContext(source, { console })).toThrow(/utanför en service worker/);
  });

  it("skriver out/sw.js som registrerar alla fyra händelser med inbakad version och lista", async () => {
    const result = await buildServiceWorker(out);
    expect(result.count).toBe(13);
    const source = await readFile(join(out, "sw.js"), "utf8");
    expect(source).not.toContain("kill-switch");
    expect(source).toContain(result.version);

    // Kör den byggda filen i en fejkad service worker-global och kontrollera
    // att den faktiskt kopplar in sig — ett bundlingsfel syns här, inte först
    // i browsern.
    const listeners = new Map<string, unknown>();
    const swGlobal: Record<string, unknown> = {
      registration: { scope: "https://ava-crm.io/" },
      location: { origin: "https://ava-crm.io" },
      addEventListener: (type: string, cb: unknown) => { listeners.set(type, cb); },
      caches: {},
      clients: { claim: async () => {} },
      skipWaiting: async () => {},
      fetch: async () => new Response(""),
      Request, Response, URL, setTimeout, clearTimeout, console,
    };
    swGlobal.self = swGlobal;
    runInNewContext(source, swGlobal);
    expect([...listeners.keys()].sort()).toEqual(["activate", "fetch", "install", "message"]);
  });
});
