import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const projectRoot = path.resolve(__dirname, "..", "..");

/**
 * E2E-tester körs mot riktiga Next.js + WebDAV-servrar (samma `bun run dev`-
 * stack som utvecklarmiljön). Tester ligger i `e2e/`.
 *
 * Kör: `npx playwright test`
 *      `npx playwright test --ui` (interaktiv)
 *      `npx playwright show-report`
 */
export default defineConfig({
  testDir: path.join(projectRoot, "test/e2e"),
  // Demo-specarna kräver en serverad `out/` och körs via
  // playwright-demo.config.ts, som startar `serve-demo-static.ts` själv.
  // Uteslut dem här så `bun run e2e` inte kör dem mot dev-servern på :3000.
  testIgnore: /(demo-invoice-document|demo-login|demo-smoke|kebab-verify|matters-employee-filter)\.spec\.ts$/,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // delar DB; håll det sekventiellt tills tester är isolerade
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never", outputFolder: path.join(projectRoot, "reports/playwright") }]]
    : [["list"], ["html", { open: "never", outputFolder: path.join(projectRoot, "reports/playwright") }]],
  outputDir: path.join(projectRoot, "reports/playwright-results"),
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.CI
    ? {
        command: "bun run dev",
        url: "http://localhost:3000",
        reuseExistingServer: false,
        timeout: 120_000,
      }
    : {
        command: "bun run dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
