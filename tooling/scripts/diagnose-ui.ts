#!/usr/bin/env tsx
/**
 * `yarn diagnose-ui` — UI-diagnose-pipeline.
 *
 * Bygger demo-bundle:n (om saknas), startar en lokal HTTP-server på `out/`,
 * launchar Playwright Chromium och besöker alla huvudvyer. Per vy:
 *   • Tar PNG-screenshot → reports/ui-diagnose/<route>.png
 *   • Samlar console-meddelanden (level: error, warning)
 *   • Samlar nätverks-fel (status >= 400)
 *   • Kör basala "inte tomt"-assertions (rubriker syns, listor har innehåll
 *     där seed-data är säker på att finnas).
 *
 * Resultatet skrivs till `reports/ui-diagnose/report.json` + en kort
 * text-sammanfattning till stdout. Ej nollställd exit-kod om fel hittas
 * → kan brytas mot i CI.
 *
 * Demo-läge på localhost kräver localStorage-trick (`firma-config.tier=demo`)
 * annars redirectar appen till login. Se [[demo-local-verify-localstorage-trick]].
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

interface RouteResult {
  route: string;
  screenshot: string;
  consoleErrors: ConsoleMsg[];
  networkErrors: NetErr[];
  assertions: Array<{ check: string; passed: boolean; detail?: string }>;
}

interface Route {
  path: string;
  name: string;
  /** Element-selectorer som MÅSTE finnas. */
  mustSee?: string[];
  /** Text som MÅSTE finnas (regex/string). */
  mustContain?: string[];
  /** Skippa rader/widgetar (nivå-1 kontroll). */
  skipEmpty?: boolean;
}

const ROUTES: Route[] = [
  { path: "/", name: "dashboard",
    mustContain: ["Dashboard", "Att göra", "Tidrapportering", "Senaste"] },
  { path: "/todo", name: "todo",
    mustContain: ["Att göra"] },
  { path: "/contacts", name: "contacts",
    mustContain: ["Kontakter"] },
  { path: "/matters", name: "matters",
    mustContain: ["Ärenden"] },
  { path: "/invoices", name: "invoices",
    mustContain: ["Fakturor"] },
  { path: "/time", name: "time-entries",
    mustContain: ["Tidregistrering"] },
  { path: "/payment-plans", name: "payment-plans",
    mustContain: ["Avbetalningsplaner"] },
  { path: "/users", name: "users",
    mustContain: ["Användare"] },
  { path: "/templates", name: "templates",
    mustContain: ["Dokumentmallar"] },
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
      // Next static export lägger route-sidor i <route>/index.html. Försök
      // direkt-match först, sen `<url>/index.html`, sen 404.
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

async function visitRoute(browser: Browser, route: Route): Promise<RouteResult> {
  const page = await browser.newPage();
  const consoleErrors: ConsoleMsg[] = [];
  const networkErrors: NetErr[] = [];

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

  const url = `http://localhost:${PORT}${BASE_PATH}${route.path}`;
  // Tvinga demo-mode INNAN första goto, annars hinner appen försöka tala med
  // self-hosted git (localhost:8080) → 401. Se [[demo-local-verify-localstorage-trick]].
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
  await page.goto(url, { waitUntil: "networkidle", timeout: 20000 }).catch(() => {});

  // Vänta tills DOM stabiliserats (tRPC-data laddat). Demo-loadern går
  // i-process men hydrerar OPFS → kräver ca 3-4s första gången.
  await page.waitForTimeout(8000);

  const assertions: RouteResult["assertions"] = [];
  for (const txt of route.mustContain ?? []) {
    const found = await page.locator(`text=${txt}`).first().isVisible().catch(() => false);
    assertions.push({ check: `must contain "${txt}"`, passed: found, detail: found ? undefined : "saknas" });
  }

  const screenshotPath = join(REPORT_DIR, `${route.name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await page.close();

  return { route: route.path, screenshot: screenshotPath, consoleErrors, networkErrors, assertions };
}

function summarize(results: RouteResult[]): { totalIssues: number; lines: string[] } {
  const lines: string[] = [];
  let totalIssues = 0;
  for (const r of results) {
    const failed = r.assertions.filter((a) => !a.passed);
    const issues = failed.length + r.consoleErrors.length + r.networkErrors.length;
    totalIssues += issues;
    const status = issues === 0 ? "OK" : `${issues} issue(s)`;
    lines.push(`  ${r.route.padEnd(20)} ${status}`);
    for (const a of failed) lines.push(`     ✗ ${a.check}: ${a.detail ?? ""}`);
    for (const e of r.consoleErrors.slice(0, 3)) lines.push(`     ! console-${e.level}: ${e.text.slice(0, 120)}`);
    for (const n of r.networkErrors.slice(0, 3)) lines.push(`     ! ${n.method} ${n.status} ${n.url.slice(0, 100)}`);
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
      results.push(await visitRoute(browser, route));
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
