import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const projectRoot = path.resolve(__dirname, "..", "..");

/**
 * Fortnox UI-E2E (#1173) — hela bokföringsflödet i webb-UIt mot den fulla
 * self-hosted-stacken (server-first + OIDC) och CI:s Fortnox-sandbox. Stacken,
 * anslutningen och kontrollen i Fortnox körs av `tooling/scripts/fortnox-ui-e2e.sh`.
 */
export default defineConfig({
  testDir: path.join(projectRoot, "test/e2e/fortnox"),
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0, // varje försök bränner verifikatnummer
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: path.join(projectRoot, "reports/playwright-fortnox") }],
  ],
  outputDir: path.join(projectRoot, "reports/playwright-fortnox-results"),
  use: {
    baseURL: process.env.AVA_WEB_URL ?? "http://localhost:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
