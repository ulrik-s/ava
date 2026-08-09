import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const projectRoot = path.resolve(__dirname, "..", "..");

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
 */
const DEMO_PORT = Number(process.env.DEMO_PORT ?? 8799);
const LOCAL_BASE_URL = `http://localhost:${DEMO_PORT}/ava`;
const baseURL = process.env.AVA_DEMO_BASE_URL ?? LOCAL_BASE_URL;

export default defineConfig({
  testDir: path.join(projectRoot, "test/e2e"),
  // Specar som behöver en serverad `out/` hör hemma här — inte i
  // playwright.config.ts, som startar `next dev` på :3000 (#932).
  //
  // `demo-smoke` och `kebab-verify` är UTELÄMNADE med flit: de hårdkodar seed-id:n
  // i det gamla formatet (`m-001-vardnad`, `m-016-brottmal-rh`, `inv-001`) som
  // seeden slutade producera för länge sedan — den kör UUID:er nu. Att ingen
  // märkt det är samma sjuka som #932: specarna låg i ingens config och kördes
  // för hand mot live-demon. De pekar numera på den lokala servern och bär
  // hermeticitets-vakten, så den som lagar dem börjar från rätt utgångsläge; att
  // ta in dem här innan dess vore bara att göra `e2e:demo` rött. Se #972.
  testMatch: /(demo-invoice-document|demo-login|matters-employee-filter)\.spec\.ts$/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  outputDir: path.join(projectRoot, "reports/playwright-demo"),
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Bara när vi kör mot vår egen `out/`. `serve-demo-static.ts` är beroendefri
  // (node:http) och läser `out/` relativt cwd → därav `cwd: projectRoot`.
  ...(process.env.AVA_DEMO_BASE_URL ? {} : {
    webServer: {
      command: `bun tooling/scripts/serve-demo-static.ts`,
      url: `${LOCAL_BASE_URL}/login/`,
      cwd: projectRoot,
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
      stdout: "ignore" as const,
      stderr: "pipe" as const,
    },
  }),
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
