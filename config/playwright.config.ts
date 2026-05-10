import { defineConfig, devices } from "@playwright/test";

/**
 * E2E-tester körs mot riktiga Next.js + WebDAV-servrar (samma `npm run dev`-
 * stack som utvecklarmiljön). Tester ligger i `e2e/`.
 *
 * Kör: `npx playwright test`
 *      `npx playwright test --ui` (interaktiv)
 *      `npx playwright show-report`
 */
export default defineConfig({
  testDir: "./test/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // delar DB; håll det sekventiellt tills tester är isolerade
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never", outputFolder: "reports/playwright" }]]
    : [["list"], ["html", { open: "never", outputFolder: "reports/playwright" }]],
  outputDir: "reports/playwright-results",
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
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: false,
        timeout: 120_000,
      }
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
