import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const projectRoot = path.resolve(__dirname, "..", "..");

/**
 * Demo-e2e: kör HELA demo-flöden mot den deployade GH-Pages-demon (eller en
 * lokalt serverad `out/` via AVA_DEMO_BASE_URL). Till skillnad från den
 * vanliga playwright.config.ts startar denna INGEN dev-server — den pekar på
 * en redan körande demo. Default = live-sajten.
 *
 *   bun run e2e:demo
 *   AVA_DEMO_BASE_URL=http://localhost:8080/ava bun run e2e:demo   # lokal out/
 */
export default defineConfig({
  testDir: path.join(projectRoot, "test/e2e"),
  testMatch: /demo-invoice-document\.spec\.ts$/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  outputDir: path.join(projectRoot, "reports/playwright-demo"),
  use: {
    baseURL: process.env.AVA_DEMO_BASE_URL ?? "https://ulrik-s.github.io/ava",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
