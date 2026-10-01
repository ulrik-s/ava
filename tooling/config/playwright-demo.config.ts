import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

import { demoPort, PROJECT_ROOT as projectRoot } from "./demo-e2e-port";

/**
 * Demo-e2e: kör HELA demo-flöden mot den byggda `out/`.
 *
 * Default är en LOKALT SERVERAD `out/` som configen startar själv — inte
 * live-demon (#932). Det gamla defaultet (`https://ulrik-s.github.io/ava`)
 * gjorde varje körning nätverksberoende: PR:er blev röda när GH Pages låg nere,
 * och ett grönt resultat sa ingenting om koden i diffen.
 *
 *   bun run build:demo && bun run e2e:demo                        # lokalt (default)
 *   AVA_DEMO_BASE_URL=https://ulrik-s.github.io/ava bun run e2e:demo   # mot live
 *
 * Sätts `AVA_DEMO_BASE_URL` startas ingen server — då pekar man med flit på
 * något som redan kör.
 *
 * Porten är worktreens egen (8800–8999, härledd ur sökvägen — #1261), eller
 * `DEMO_PORT`. Configen startar ALLTID en egen server (ingen
 * `reuseExistingServer`): är porten upptagen fälls körningen i stället för att
 * tyst testa en annan worktrees bygge.
 */
const DEMO_PORT = demoPort();
const LOCAL_BASE_URL = `http://localhost:${DEMO_PORT}/ava`;
const baseURL = process.env.AVA_DEMO_BASE_URL ?? LOCAL_BASE_URL;

export default defineConfig({
  testDir: path.join(projectRoot, "test/e2e"),
  // Specar som behöver en serverad `out/` hör hemma här — inte i
  // playwright.config.ts, som startar `next dev` på :3000 (#932).
  //
  // Alla demo-specar körs numera (#972). `demo-smoke` och `kebab-verify` låg
  // utanför tills de slutat hårdkoda seed-id:n; de slår upp sina fixtures i
  // `demo-seed.json` via `fetchDemoSeed`. Lägg inte till en spec här som pekar
  // på ett id den inte slagit upp — det var precis så de tystnade förra gången.
  testMatch: /(column-menu|demo-helper-isolation|chrome-regressions|matter-watch|billing-watch|demo-invoice-document|demo-kostnadsrakning-verdict|demo-kostnadsrakning-void|demo-kostnadsrakning-taxa|demo-login|demo-smoke|kebab-verify|matters-employee-filter|docking-layout|hourly-rates|demo-offline|demo-storage-persistence|demo-hydration|demo-jobs-hung-worker|demo-jobs-fifo|demo-mobile-menu|demo-reports|demo-no-page-scroll|demo-kr-document-folder|demo-display-labels|demo-panels-have-data|demo-sync-devices|demo-backup-gating|demo-conflict-check|demo-time-entry-create|demo-reload-durability|demo-boot-error|demo-deploy-resilience)\.spec\.ts$/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  outputDir: path.join(projectRoot, "reports/playwright-demo"),
  use: {
    baseURL,
    // Byråns tid (svensk). Appen räknar "idag" i Europe/Stockholm (stockholmDay);
    // en UTC-webbläsare hamnar på gårdagen mellan 22 och 24 UTC och fick
    // datumkänsliga tester (frist idag) att falla varje kväll.
    timezoneId: "Europe/Stockholm",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Service workern (#1240) blockeras som default: varje test får en färsk
    // kontext, och en SW som förcachar hela skalet i bakgrunden per test gör
    // bara körningen långsammare. `demo-offline.spec.ts` slår på den
    // (`serviceWorkers: "allow"`) och testar den på riktigt.
    serviceWorkers: "block",
  },
  // Bara när vi kör mot vår egen `out/`. `serve-demo-static.ts` är beroendefri
  // (node:http) och läser `out/` relativt cwd → därav `cwd: projectRoot`.
  ...(process.env.AVA_DEMO_BASE_URL ? {} : {
    webServer: {
      command: `bun tooling/scripts/serve-demo-static.ts`,
      url: `${LOCAL_BASE_URL}/login/`,
      cwd: projectRoot,
      env: { DEMO_PORT: String(DEMO_PORT) },
      timeout: 60_000,
      reuseExistingServer: false,
      stdout: "ignore" as const,
      stderr: "pipe" as const,
    },
  }),
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
