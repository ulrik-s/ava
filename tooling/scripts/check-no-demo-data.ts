#!/usr/bin/env bun
/**
 * `check-no-demo-data.ts` (#1352) — fäller prod-bygget om demodata följt med.
 *
 *   bun tooling/scripts/check-no-demo-data.ts out
 *
 * Prod (ava-crm.io) och GH Pages-demon bygger samma statiska export, men bara
 * demon ska ha datan: `demo-seed.json`, `.ava/` (användare, org), `manifest.json`
 * över datafilerna, `documents/content/*.pdf` och en förrenderad sida per
 * demo-id. Skalet laddas utan inloggning (#1245), så allt som ligger i `out/`
 * på byråns domän är publikt. `build-demo.sh` kör kontrollen sist i
 * `AVA_BUILD_TARGET=server`; Caddy nekar dessutom samma sökvägar
 * (`DEMO_DATA_PATHS`, försvar på djupet — t.ex. efter en rollback till en
 * release byggd före #1352).
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import { DEMO_EMAIL_DOMAIN } from "../demo-config";

/**
 * Sökvägar där bara demodata bor, i Caddys path-matcher-syntax (`*` först =
 * suffix, sist = prefix). Caddyfile nekar exakt den här listan (testat).
 * Ingen app-rutt ligger under dem: projektionerna är `*.json`
 * (`matters/active/<id>.json`, `documents/<id>.json` …), blobbarna ligger i
 * `documents/content/`.
 */
export const DEMO_DATA_PATHS = ["/demo-seed.json", "/.ava/*", "/documents/content/*", "*.json"] as const;

/**
 * Undantag (Caddys `not path`): PWA-manifestet ur `public/` (layout.tsx länkar
 * det) och Next:s byggda tillgångar, så en framtida JSON-tillgång i
 * `_next/static` aldrig nekas.
 */
export const ALLOWED_PATHS = ["/manifest.json", "/_next/*"] as const;

/** Entitetsrutter med `[id]`-segment (samma lista som shell-routing-shimmen). */
const ENTITY_PAGE = /^\/(?:matters|contacts|invoices|payment-plans|users|templates)\/([^/]+)\//;

/** Statiska segment under entitetsrutterna — app-sidor, inte demo-id:n. */
const STATIC_SEGMENTS: ReadonlySet<string> = new Set(["__shell__", "new"]);

/** Textfiler som kan bära demo-identiteter (RSC-payloads, HTML, JS, JSON). */
const TEXT_FILE = /\.(?:html|txt|js|json)$/;

const DEMO_IDENTITY = `@${DEMO_EMAIL_DOMAIN}`;

/** Caddys path-matcher, så långt `DEMO_DATA_PATHS` använder den. */
export function matchesCaddyPath(urlPath: string, pattern: string): boolean {
  if (pattern.startsWith("*")) return urlPath.endsWith(pattern.slice(1));
  if (pattern.endsWith("*")) return urlPath.startsWith(pattern.slice(0, -1));
  return urlPath === pattern;
}

/** Nekar Caddy sökvägen som demodata? */
export function isDemoDataPath(urlPath: string): boolean {
  const matches = (p: string): boolean => matchesCaddyPath(urlPath, p);
  return !ALLOWED_PATHS.some(matches) && DEMO_DATA_PATHS.some(matches);
}

/** En förrenderad sida för ett demo-id (`/matters/<uuid>/index.html`)? */
export function isDemoEntityPage(urlPath: string): boolean {
  const segment = ENTITY_PAGE.exec(urlPath)?.[1];
  return segment !== undefined && !STATIC_SEGMENTS.has(segment);
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

async function reasonFor(file: string, urlPath: string): Promise<string | null> {
  if (isDemoDataPath(urlPath)) return "demodata";
  if (isDemoEntityPage(urlPath)) return "förrenderad demo-sida";
  if (TEXT_FILE.test(urlPath) && (await readFile(file, "utf8")).includes(DEMO_IDENTITY)) {
    return `innehåller ${DEMO_IDENTITY}`;
  }
  return null;
}

/** Alla filer i `outDir` som inte hör hemma i ett prod-bygge, som `"/sökväg: skäl"`. */
export async function findDemoData(outDir: string): Promise<string[]> {
  const found: string[] = [];
  for (const file of await walk(outDir)) {
    const urlPath = `/${relative(outDir, file).split(sep).join("/")}`;
    const reason = await reasonFor(file, urlPath);
    if (reason) found.push(`${urlPath}: ${reason}`);
  }
  return found.sort();
}

if (import.meta.main) {
  const outDir = resolve(process.argv[2] ?? "out");
  const found = await findDemoData(outDir);
  if (found.length > 0) {
    console.error(`[check-no-demo-data] ${found.length} filer med demodata i ${outDir}:`);
    for (const f of found.slice(0, 20)) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`[check-no-demo-data] ${outDir}: ingen demodata`);
}
