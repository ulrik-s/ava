import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

import { PROJECT_ROOT as projectRoot } from "./demo-e2e-port";

/**
 * Outlook-tilläggets E2E (lager 3 i CI): den BYGGDA task-panen
 * (office-addin/dist) med fake-Office (test/helpers/office-fake.ts) mot
 * tooling/scripts/addin-e2e-server.ts, som kör den riktiga tRPC-handlern.
 *
 * Två motorer: Chromium (Outlook på Windows/webben, WebView2) och WebKit
 * (Outlook på Mac kör task-panen i WKWebView — det juristerna använder).
 *
 *   bun run e2e:addin
 */
const PORT = Number(process.env.AVA_ADDIN_E2E_PORT ?? 3460);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: path.join(projectRoot, "test/e2e/addin"),
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  outputDir: path.join(projectRoot, "reports/playwright-addin"),
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: "bun run addin:build && bun tooling/scripts/addin-e2e-server.ts",
    url: `${baseURL}/taskpane.html`,
    cwd: projectRoot,
    env: { AVA_ADDIN_E2E_PORT: String(PORT) },
    timeout: 60_000,
    reuseExistingServer: false,
    stdout: "ignore" as const,
    stderr: "pipe" as const,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
