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
  // demo-invoice-document.spec.ts körs mot den deployade demon via
  // playwright-demo.config.ts (ingen dev-server) — uteslut den här så
  // `bun run e2e` inte kör den mot :3000. (demo-smoke.spec.ts lämnas orörd.)
  testIgnore: /demo-invoice-document\.spec\.ts$/,
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
