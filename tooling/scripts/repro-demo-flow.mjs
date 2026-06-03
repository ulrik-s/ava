/**
 * repro-demo-flow.mjs — reproducerbar testmiljö för demo-navigerings-/hydrerings-
 * buggar (t.ex. React #418). Driver flödet matter → "dom + prutning" → Faktura-
 * länk → öppna dokument och rapporterar console-fel, #418-träffar, oväntade
 * navigeringar (t.ex. bounce till dashboard) + spar screenshots.
 *
 * Två lägen:
 *   - lokalt (default): serverar ./out som GitHub Pages (404 → /404.html).
 *     Kräver att out/ är byggt: `DEMO_BASE_PATH=/ava bash tooling/scripts/build-demo.sh`
 *   - live:  --live   → kör mot https://ulrik-s.github.io/ava (den deployade demon)
 *
 * Browser: --firefox (default, = användarens browser) eller --chromium.
 * Använd --headed för att se fönstret.
 *
 * OBS: en ren Firefox/Chromium reproducerar INTE #418 i detta flöde (verifierat).
 * Får du #418 i din vanliga browser men inte här → testa din browser i privat
 * läge / med tillägg avstängda; React #418 orsakas ofta av ett tillägg som
 * muterar DOM:en innan hydrering. Felrapportens "domMiljö"-fält pekar ut vilket.
 *
 *   node tooling/scripts/repro-demo-flow.mjs
 *   node tooling/scripts/repro-demo-flow.mjs --live --firefox --headed
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { firefox, chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = new Set(process.argv.slice(2));
const LIVE = args.has("--live");
const ENGINE = args.has("--chromium") ? chromium : firefox;
const HEADED = args.has("--headed");
const MATTER = process.env.REPRO_MATTER || "92d63776-c955-54dc-8430-3573bed7829b";
const PORT = Number(process.env.REPRO_PORT || 8793);

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain", ".map": "application/json", ".webmanifest": "application/manifest+json" };

function startServer() {
  const out = path.join(ROOT, "out");
  if (!fs.existsSync(out)) throw new Error("out/ saknas — kör build-demo.sh först (eller använd --live).");
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/ava/, "");
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    let file = path.join(out, rel);
    if (!file.startsWith(out) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      const idx = path.join(file, "index.html");
      if (fs.existsSync(idx)) file = idx;
      else { res.writeHead(404, { "Content-Type": "text/html" }); return res.end(fs.readFileSync(path.join(out, "404.html"))); }
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(PORT, () => r({ server, base: `http://localhost:${PORT}/ava` })));
}

const FIRMA = { tier: "demo", repo: LIVE ? "ulrik-s/ava" : "ulrik-s/ava-demo", token: "", principalId: "5a381ef4-8a34-5e42-b21e-0f0107678d09", organizationId: "83f68f9a-5f27-5199-b54b-e4b2fa380e14", authorName: "Björn Bauer", authorEmail: "bjorn@ava.demo" };

let serverHandle = null;
let base = "https://ulrik-s.github.io/ava";
if (!LIVE) { const s = await startServer(); serverHandle = s.server; base = s.base; }
console.log(`[repro] ${LIVE ? "LIVE" : "lokal out/"} · ${ENGINE === firefox ? "firefox" : "chromium"} · ${base}`);

const browser = await ENGINE.launch({ headless: !HEADED });
const ctx = await browser.newContext();
await ctx.addInitScript((cfg) => { try { localStorage.setItem("ava.firma", JSON.stringify(cfg)); } catch {} }, FIRMA);
const page = await ctx.newPage();
const log = [];
const m = (s) => { log.push(s); console.log(s); };
page.on("console", (e) => { const t = `[c.${e.type()}] ${e.text()}`.slice(0, 240); if (!/preloaded with link preload|gh-pages-loader/.test(t)) log.push(t); });
page.on("pageerror", (e) => m(`[PAGEERROR] ${e.message}`));
page.on("framenavigated", (f) => { if (f === page.mainFrame()) m(`[NAV] ${f.url()}`); });
fs.mkdirSync(path.join(ROOT, "reports"), { recursive: true });
const shot = (n) => page.screenshot({ path: path.join(ROOT, "reports", `repro-${n}.png`), fullPage: true }).catch(() => {});

m("1) matter"); await page.goto(`${base}/matters/${MATTER}/`, { waitUntil: "load", timeout: 45000 }).catch((e) => m("goto " + e.message)); await page.waitForTimeout(5000);
const vb = page.getByRole("button", { name: /Ange dom \+ prutning/i });
if (await vb.count()) {
  m("2) dom + prutning"); await vb.first().click().catch(() => {}); await page.waitForTimeout(1500);
  const sb = page.getByRole("button", { name: /^Skapa faktura$/ });
  if (await sb.count()) { await sb.first().click().catch(() => {}); await page.waitForTimeout(7000); }
}
const fl = page.locator('main a[href*="/invoices/"]').first();
if (await fl.count()) {
  m("3) Faktura-länk → " + (await fl.getAttribute("href"))); await fl.click().catch(() => {}); await page.waitForTimeout(7000); m("   nu: " + page.url());
  const doc = page.locator('main a,main button').filter({ hasText: /\.pdf|\.html|\.docx|Faktura|Kostnadsräkning/ }).first();
  if (await doc.count()) { m("4) öppna dokument"); await doc.click().catch(() => {}); await page.waitForTimeout(7000); }
}
await shot("final");
m("SLUT-URL: " + page.url());
m(`RESULTAT → #418: ${log.filter((l) => /#418|error 418|hydrat/i.test(l)).length} | dashboard-bounce: ${/\/ava\/?$/.test(page.url().split("#")[0])}`);
await browser.close();
if (serverHandle) serverHandle.close();
