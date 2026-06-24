import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const projectRoot = path.resolve(__dirname, "..", "..");

/**
 * Keep-both-konflikt-e2e (#742) — UI-driven verifiering mot den FULLA
 * self-hosted-stacken (server-first tRPC + OIDC), inte den statiska demon.
 * Stacken + konflikt-seeden körs av `tooling/scripts/conflict-e2e.sh`; spec:en
 * loggar in via Keycloaks riktiga formulär och bekräftar i webb-UIt att ärendet
 * har 2 filer (originalet + keep-both-syskonet). Web på AVA_WEB_PORT (8080).
 */
export default defineConfig({
  testDir: path.join(projectRoot, "test/e2e/conflict"),
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: path.join(projectRoot, "reports/playwright-conflict") }],
  ],
  outputDir: path.join(projectRoot, "reports/playwright-conflict-results"),
  use: {
    baseURL: process.env.AVA_WEB_URL ?? "http://localhost:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
