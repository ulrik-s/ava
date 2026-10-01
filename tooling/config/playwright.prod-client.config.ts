import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const projectRoot = path.resolve(__dirname, "..", "..");

/**
 * Prod-klienten genom prod-Caddyn (#1352): den self-hostade appen, byggd som i
 * prod (`AVA_BUILD_TARGET=server`), serverad av den riktiga Caddyfile:n.
 * Stacken (Caddy + låtsas-oauth2-proxy + ev. server-first) startas av
 * `tooling/scripts/caddy-e2e/caddy-prod-e2e.sh`, som sätter
 * `AVA_PROD_CLIENT_BASE_URL`.
 */
export default defineConfig({
  testDir: path.join(projectRoot, "test/e2e/prod-client"),
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  outputDir: path.join(projectRoot, "reports/playwright-prod-client"),
  use: {
    baseURL: process.env.AVA_PROD_CLIENT_BASE_URL ?? "http://127.0.0.1:18352",
    timezoneId: "Europe/Stockholm",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Som demo-e2e: ingen service worker som förcachar skalet per test.
    serviceWorkers: "block",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
