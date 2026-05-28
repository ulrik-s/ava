#!/usr/bin/env tsx
/**
 * `yarn diagnose-ui` — UI-diagnose-pipeline (djup-läge).
 *
 * För varje huvudvy:
 *   1. Besök sidan, screenshota, kolla "must contain"-text, samla console/
 *      network-errors.
 *   2. Hitta alla detalj-länkar (rader/items som länkar in i ärenden,
 *      kontakter, fakturor osv.) och klicka in på de N första.
 *   3. För varje detalj: screenshota, samla errors, validera "no error
 *      boundary"-tillstånd, gå tillbaka och ta nästa.
 *
 * Detta fångar trasiga detaljsidor (404, ohanterad input, döda imports)
 * som annars bara märks när användaren faktiskt klickar.
 *
 * Resultat:
 *   - reports/ui-diagnose/<route>.png (huvudvy)
 *   - reports/ui-diagnose/<route>/<n>.png (detaljvyer)
 *   - reports/ui-diagnose/report.json (allt strukturerat)
 *
 * Demo-mode på localhost kräver localStorage-trick — se
 * [[demo-local-verify-localstorage-trick]].
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { resolve, join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const ROOT = resolve(__dirname, "..", "..");
const OUT_DIR = join(ROOT, "out");
const BASE_PATH = "/ava";
const PORT = 4848;
const REPORT_DIR = join(ROOT, "reports", "ui-diagnose");

interface ConsoleMsg { level: string; text: string; url?: string }
interface NetErr { url: string; status: number; method: string }

interface ItemResult {
  href: string;
  label: string;
  screenshot: string;
  consoleErrors: ConsoleMsg[];
  networkErrors: NetErr[];
  hadErrorBoundary: boolean;
  rendered: boolean;
}

interface RouteResult {
  route: string;
  screenshot: string;
  consoleErrors: ConsoleMsg[];
  networkErrors: NetErr[];
  assertions: Array<{ check: string; passed: boolean; detail?: string }>;
  items: ItemResult[];
}

interface Route {
  path: string;
  name: string;
  /** Text som MÅSTE finnas i huvudvyn. */
  mustContain?: string[];
  /** Regex för href som är "detalj-länkar" på denna sida (utan basePath). */
  detailHrefPattern?: RegExp;
  /** Max antal items att klicka per sida (default 3). */
  maxItems?: number;
}

const ROUTES: Route[] = [
  { path: "/", name: "dashboard",
    mustContain: ["Dashboard", "Att göra", "Tidrapportering", "Senaste"],
    detailHrefPattern: /\/matters\/[^/?#]+\/?$/ },
  { path: "/todo", name: "todo",
    mustContain: ["Att göra"],
    detailHrefPattern: /\/matters\/[^/?#]+\/?$/ },
  { path: "/contacts", name: "contacts",
    mustContain: ["Kontakter"],
    detailHrefPattern: /\/contacts\/[^/?#]+\/?$/ },
  { path: "/matters", name: "matters",
    mustContain: ["Ärenden"],
    detailHrefPattern: /\/matters\/[^/?#]+\/?$/ },
  { path: "/invoices", name: "invoices",
    mustContain: ["Fakturor"],
    detailHrefPattern: /\/invoices\/[^/?#]+\/?$/ },
  { path: "/time", name: "time-entries",
    mustContain: ["Tidregistrering"],
    detailHrefPattern: /\/matters\/[^/?#]+\/?$/ },
  { path: "/payment-plans", name: "payment-plans",
    mustContain: ["Avbetalningsplaner"],
    detailHrefPattern: /\/payment-plans\/[^/?#]+\/?$/ },
  { path: "/users", name: "users",
    mustContain: ["Användare"],
    detailHrefPattern: /\/users\/[^/?#]+\/?$/ },
  { path: "/templates", name: "templates",
    mustContain: ["Dokumentmallar"],
    detailHrefPattern: /\/templates\/[^/?#]+/ },
  { path: "/conflicts", name: "conflicts",
    mustContain: ["Jävskontroll"] },
  { path: "/reports", name: "reports",
    mustContain: ["Rapporter"] },
  { path: "/search", name: "search",
    mustContain: ["Dokumentsökning"] },
  { path: "/settings", name: "settings",
    mustContain: ["Standardvyer"] },
];

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

function serveOut(): Server {
  const server = createServer(async (req, res) => {
    try {
      let url = new URL(req.url ?? "/", `http://localhost:${PORT}`).pathname;
      if (url.startsWith(BASE_PATH)) url = url.slice(BASE_PATH.length);
      if (url === "" || url === "/") url = "/index.html";
      const candidates = [
        join(OUT_DIR, url),
        join(OUT_DIR, url, "index.html"),
        join(OUT_DIR, `${url}.html`),
        join(OUT_DIR, "404.html"),
      ];
      const filePath = candidates.find((p) => existsSync(p) && statSync(p).isFile()) ?? candidates[candidates.length - 1];
      const data = await readFile(filePath);
      const ext = filePath.slice(filePath.lastIndexOf("."));
      res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream", "Cache-Control": "no-store" });
      res.end(data);
    } catch (e) {
      res.writeHead(500); res.end(String(e));
    }
  });
  server.listen(PORT);
  return server;
}

async function buildIfNeeded(): Promise<void> {
  if (existsSync(join(OUT_DIR, "manifest.json"))) {
    console.log("[diagnose-ui] out/ finns redan — hoppar bygg");
    return;
  }
  console.log("[diagnose-ui] Bygger out/...");
  await new Promise<void>((res, rej) => {
    const p: ChildProcess = spawn("bash", ["tooling/scripts/build-demo.sh"], {
      cwd: ROOT, stdio: "inherit", env: { ...process.env, DEMO_BASE_PATH: BASE_PATH },
    });
    p.on("exit", (code) => code === 0 ? res() : rej(new Error(`build-demo exit ${code}`)));
  });
}

function attachListeners(page: Page, consoleErrors: ConsoleMsg[], networkErrors: NetErr[]): void {
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      consoleErrors.push({ level: msg.type(), text: msg.text(), url: msg.location().url });
    }
  });
  page.on("response", (resp) => {
    if (resp.status() >= 400) {
      networkErrors.push({ url: resp.url(), status: resp.status(), method: resp.request().method() });
    }
  });
}

async function setupDemoMode(page: Page): Promise<void> {
  await page.addInitScript((origin: string) => {
    localStorage.setItem("ava.firma", JSON.stringify({
      tier: "demo",
      repo: origin,
      token: "",
      organizationId: "demo-firma-ab",
      authorName: "AVA Demo",
      authorEmail: "demo@ava.local",
    }));
  }, `http://localhost:${PORT}${BASE_PATH}`);
}

async function collectDetailLinks(page: Page, pattern: RegExp, max: number): Promise<Array<{ href: string; label: string }>> {
  const links = await page.evaluate((basePath: string) => {
    const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("main a[href], [data-content] a[href], a[href]"));
    return anchors.map((a) => ({ href: a.getAttribute("href") ?? "", label: (a.textContent ?? "").trim().slice(0, 60), basePath }));
  }, BASE_PATH);

  const seen = new Set<string>();
  const out: Array<{ href: string; label: string }> = [];
  for (const l of links) {
    // Strip basePath om det finns
    let normalized = l.href;
    if (normalized.startsWith(BASE_PATH)) normalized = normalized.slice(BASE_PATH.length);
    if (!normalized.startsWith("/")) continue;
    if (!pattern.test(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push({ href: normalized, label: l.label });
    if (out.length >= max) break;
  }
  return out;
}

async function detectErrorBoundary(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    const txt = document.body.innerText;
    return /Kunde inte ladda|Något gick fel|Application error|Unhandled Runtime Error/i.test(txt);
  });
}

async function visitDetail(
  browser: Browser, routeName: string, baseUrl: string, item: { href: string; label: string }, idx: number,
): Promise<ItemResult> {
  const page = await browser.newPage();
  const consoleErrors: ConsoleMsg[] = [];
  const networkErrors: NetErr[] = [];
  attachListeners(page, consoleErrors, networkErrors);
  await setupDemoMode(page);

  const fullUrl = `${baseUrl}${item.href}`;
  await page.goto(fullUrl, { waitUntil: "networkidle", timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(4000);

  const hadErrorBoundary = await detectErrorBoundary(page);
  const rendered = !hadErrorBoundary && await page.locator("h1, h2").first().isVisible().catch(() => false);

  const dir = join(REPORT_DIR, routeName);
  await mkdir(dir, { recursive: true });
  const safeIdx = String(idx).padStart(2, "0");
  const screenshotPath = join(dir, `${safeIdx}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await page.close();

  return { href: item.href, label: item.label, screenshot: screenshotPath, consoleErrors, networkErrors, hadErrorBoundary, rendered };
}

async function visitRoute(browser: Browser, route: Route): Promise<RouteResult> {
  const page = await browser.newPage();
  const consoleErrors: ConsoleMsg[] = [];
  const networkErrors: NetErr[] = [];
  attachListeners(page, consoleErrors, networkErrors);
  await setupDemoMode(page);

  const baseUrl = `http://localhost:${PORT}${BASE_PATH}`;
  await page.goto(`${baseUrl}${route.path}`, { waitUntil: "networkidle", timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(8000);

  const assertions: RouteResult["assertions"] = [];
  for (const txt of route.mustContain ?? []) {
    const found = await page.locator(`text=${txt}`).first().isVisible().catch(() => false);
    assertions.push({ check: `must contain "${txt}"`, passed: found, detail: found ? undefined : "saknas" });
  }

  const screenshotPath = join(REPORT_DIR, `${route.name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  // Samla detalj-länkar innan vi stänger huvudsidan
  const items: ItemResult[] = [];
  if (route.detailHrefPattern) {
    const max = route.maxItems ?? 3;
    const found = await collectDetailLinks(page, route.detailHrefPattern, max);
    await page.close();
    for (let i = 0; i < found.length; i++) {
      items.push(await visitDetail(browser, route.name, baseUrl, found[i], i + 1));
    }
  } else {
    await page.close();
  }

  return { route: route.path, screenshot: screenshotPath, consoleErrors, networkErrors, assertions, items };
}

// eslint-disable-next-line complexity -- skriptkod: lots of formatting branches
function summarize(results: RouteResult[]): { totalIssues: number; lines: string[] } {
  const lines: string[] = [];
  let totalIssues = 0;
  for (const r of results) {
    const failed = r.assertions.filter((a) => !a.passed);
    const issues = failed.length + r.consoleErrors.length + r.networkErrors.length;
    const itemIssues = r.items.reduce(
      (s, it) => s + (it.hadErrorBoundary ? 1 : 0) + (it.rendered ? 0 : 1) + it.consoleErrors.length + it.networkErrors.length,
      0,
    );
    totalIssues += issues + itemIssues;
    const status = issues + itemIssues === 0 ? "OK" : `${issues + itemIssues} issue(s)`;
    lines.push(`  ${r.route.padEnd(20)} ${status} (${r.items.length} items)`);
    for (const a of failed) lines.push(`     ✗ ${a.check}: ${a.detail ?? ""}`);
    for (const e of r.consoleErrors.slice(0, 2)) lines.push(`     ! console-${e.level}: ${e.text.slice(0, 120)}`);
    for (const n of r.networkErrors.slice(0, 2)) lines.push(`     ! ${n.method} ${n.status} ${n.url.slice(0, 100)}`);
    for (const it of r.items) {
      const itIssues = (it.hadErrorBoundary ? 1 : 0) + (it.rendered ? 0 : 1) + it.consoleErrors.length + it.networkErrors.length;
      const itStatus = itIssues === 0 ? "OK" : `${itIssues} issue(s)`;
      const labelOrHref = it.label || it.href;
      lines.push(`     → ${it.href.padEnd(40)} ${itStatus}  ${labelOrHref.slice(0, 40)}`);
      if (it.hadErrorBoundary) lines.push(`        ✗ error-boundary triggered`);
      if (!it.rendered && !it.hadErrorBoundary) lines.push(`        ✗ ingen h1/h2 hittad`);
      for (const e of it.consoleErrors.slice(0, 2)) lines.push(`        ! console-${e.level}: ${e.text.slice(0, 100)}`);
      for (const n of it.networkErrors.slice(0, 2)) lines.push(`        ! ${n.method} ${n.status} ${n.url.slice(0, 80)}`);
    }
  }
  return { totalIssues, lines };
}

async function main(): Promise<void> {
  await mkdir(REPORT_DIR, { recursive: true });
  await buildIfNeeded();

  const server = serveOut();
  console.log(`[diagnose-ui] Servar out/ på http://localhost:${PORT}${BASE_PATH}/`);

  const browser = await chromium.launch({ headless: true });
  const results: RouteResult[] = [];
  try {
    for (const route of ROUTES) {
      console.log(`[diagnose-ui] → ${route.path}`);
      const r = await visitRoute(browser, route);
      results.push(r);
      if (r.items.length > 0) {
        console.log(`            ${r.items.length} detalj-vyer besökta`);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  await writeFile(join(REPORT_DIR, "report.json"), JSON.stringify(results, null, 2));
  const { totalIssues, lines } = summarize(results);
  console.log("\n[diagnose-ui] Resultat:");
  for (const l of lines) console.log(l);
  console.log(`\n[diagnose-ui] Screenshots i ${REPORT_DIR}/`);
  console.log(`[diagnose-ui] Full rapport: ${join(REPORT_DIR, "report.json")}`);

  process.exit(totalIssues > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
