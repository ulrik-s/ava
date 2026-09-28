#!/usr/bin/env bun
/**
 * `build-service-worker.ts` (#1240) — bygger `out/sw.js` efter den statiska
 * exporten.
 *
 *   bun tooling/scripts/build-service-worker.ts out
 *
 * 1. Väljer vad som förcachas: app-skalet = sidorna utan id (och deras
 *    RSC-payloads), `__shell__`-sidorna, `_next/static` utan källkartor, och
 *    favicon. Seedade id-sidor, 404-sidor och ALL data (`.ava/`, demo-seed,
 *    dokument) lämnas utanför — datan bor i IndexedDB.
 * 2. Versionen är en hash över de förcachade filernas innehåll: samma bygge
 *    ger samma version (ingen onödig "ny version"-fråga), ändrat skal ger ny.
 * 3. Bundlar `src/lib/client/pwa/sw-entry.ts` med version och lista inbakade.
 *
 * Körs av `build-demo.sh` (demo och prod bygger båda den statiska exporten).
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const ENTRY = fileURLToPath(new URL("../../src/lib/client/pwa/sw-entry.ts", import.meta.url));

/** Seedade detaljsidor ligger under ett UUID-segment — de förcachas inte. */
const UUID_SEGMENT = /(^|\/)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/|$)/i;

/** Next:s felsidor — aldrig en sida någon ska landa på offline. */
const ERROR_PAGE_DIRS = new Set(["404", "_not-found"]);

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

/** Katalogen (app-relativ, med snedstreck) en `index.html` hör till — eller null om den inte är skal. */
function shellPageDir(rel: string): string | null {
  if (!rel.endsWith("index.html")) return null;
  const dir = rel.slice(0, -"index.html".length);
  const top = dir.split("/")[0] ?? "";
  if (UUID_SEGMENT.test(dir) || ERROR_PAGE_DIRS.has(top)) return null;
  return dir;
}

function isRscPayload(name: string): boolean {
  return name === "index.txt" || (name.startsWith("__next.") && name.endsWith(".txt"));
}

function isStaticAsset(rel: string): boolean {
  return (rel.startsWith("_next/static/") && !rel.endsWith(".map")) || rel === "favicon.ico";
}

/** App-relativa URL-sökvägar att förcacha, sorterade. */
export async function collectPrecache(outDir: string): Promise<string[]> {
  const files = (await walk(outDir)).map((f) => relative(outDir, f).split(sep).join("/"));
  const pageDirs = new Set(files.map(shellPageDir).filter((d): d is string => d !== null));
  if (!pageDirs.has("")) throw new Error(`[sw] ${outDir}/index.html saknas — kör next build först`);

  const paths = new Set<string>();
  for (const dir of pageDirs) paths.add(`/${dir}`);
  for (const rel of files) {
    const slash = rel.lastIndexOf("/");
    const dir = rel.slice(0, slash + 1);
    const name = rel.slice(slash + 1);
    if (isStaticAsset(rel) || (pageDirs.has(dir) && isRscPayload(name))) paths.add(`/${rel}`);
  }
  return [...paths].sort();
}

/** Filen på disk bakom en förcachad URL-sökväg (`/matters/` → `matters/index.html`). */
function diskPath(outDir: string, urlPath: string): string {
  return join(outDir, urlPath.endsWith("/") ? `${urlPath}index.html` : urlPath);
}

/** 16 hex-tecken sha256 över sökvägar + innehåll. */
export async function precacheVersion(outDir: string, paths: readonly string[]): Promise<string> {
  const hash = createHash("sha256");
  for (const p of paths) {
    hash.update(p);
    hash.update("\0");
    hash.update(await readFile(diskPath(outDir, p)));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

/** Resultatet av ett bygge. */
export interface ServiceWorkerBuild {
  version: string;
  count: number;
  bytes: number;
}

/** Bygg `<outDir>/sw.js`. `entry` är injicerbar för tester. */
export async function buildServiceWorker(outDir: string, entry: string = ENTRY): Promise<ServiceWorkerBuild> {
  const paths = await collectPrecache(outDir);
  const version = await precacheVersion(outDir, paths);
  // `bun build` som barnprocess, inte `Bun.build` in-process: den senare
  // förgiftar modulupplösningen för resten av processen (sågs som "Cannot find
  // module" i efterföljande testfiler i samma bun test-worker).
  try {
    await promisify(execFile)(process.execPath, [
      "build", entry,
      "--target=browser", "--format=iife", "--minify",
      "--define", `__AVA_SW_VERSION__=${JSON.stringify(version)}`,
      "--define", `__AVA_SW_PRECACHE__=${JSON.stringify(paths)}`,
      "--outfile", join(outDir, "sw.js"),
    ]);
  } catch (e) {
    throw new Error(`[sw] bundling misslyckades: ${e instanceof Error ? e.message : String(e)}`);
  }
  let bytes = 0;
  for (const p of paths) bytes += (await stat(diskPath(outDir, p))).size;
  return { version, count: paths.length, bytes };
}

if (import.meta.main) {
  const outDir = resolve(process.argv[2] ?? "out");
  const { version, count, bytes } = await buildServiceWorker(outDir);
  console.log(`[sw] ${outDir}/sw.js: version ${version}, ${count} filer förcachas (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
}
