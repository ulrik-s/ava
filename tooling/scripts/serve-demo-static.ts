#!/usr/bin/env bun
/**
 * `serve-demo-static.ts` — minimal statisk server för `out/` under `/ava`-
 * prefixet, som speglar GitHub Pages (okänd path → 404.html SPA-fallback).
 * Används av demo-e2e:t i CI (`bun run e2e:demo` mot en serverad out/) utan
 * att dra in docker/nginx (demo-serve.sh kräver docker).
 *
 *   bun tooling/scripts/serve-demo-static.ts            # port 8799
 *   DEMO_PORT=8080 bun tooling/scripts/serve-demo-static.ts
 *
 * Öppna http://localhost:8799/ava/. Avsiktligt ZERO beroenden (node:http).
 */

import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";

const ROOT = join(process.cwd(), "out");
const PORT = Number(process.env.DEMO_PORT ?? 8799);
const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".pdf": "application/pdf", ".txt": "text/plain", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".webmanifest": "application/manifest+json",
};

/** Returnera en serverbar fil-path (fil direkt, eller katalogens index.html). */
async function resolveFile(p: string): Promise<string | null> {
  try {
    const s = await stat(p);
    if (s.isFile()) return p;
    if (s.isDirectory()) {
      const idx = join(p, "index.html");
      await stat(idx);
      return idx;
    }
  } catch { /* saknas */ }
  return null;
}

const server = createServer((req, res) => {
  void (async () => {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    const rel = url.startsWith("/ava") ? url.slice(4) : url; // strip GH-Pages-prefixet
    // Fil → annars 404.html (SPA-fallback, precis som GH Pages).
    const file = (await resolveFile(join(ROOT, rel))) ?? (await resolveFile(join(ROOT, "404.html")));
    if (!file) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(await readFile(file));
  })();
});

server.listen(PORT, () => console.log(`[serve-demo-static] http://localhost:${PORT}/ava/ (out/)`));
