import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const projectRoot = path.resolve(__dirname, "..");

/**
 * Scenario-tester (test/e2e/scenarios/) — multi-step user journeys
 * mot riktig Next.js + Postgres + Meili.
 *
 * Skiljer sig från `playwright.config.ts` (smoke-tester) genom:
 *   - längre timeout (varje scenario gör flera form-submit:s)
 *   - reseedar databasen mellan testen (workers: 1)
 *   - peakar webServer-vänteperioden upp till 3 min (Next.js + Prisma
 *     första-init kan ta tid på Mac)
 *
 * Kör:   yarn test:scenarios
 * Krav:  docker-compose (postgres + meili + tika) uppe; seed:ad data;
 *        Next.js dev server (yarn dev:next) eller webServer-flagga
 *        nedan startar den.
 */
export default defineConfig({
  testDir: path.join(projectRoot, "test/e2e/scenarios"),
  timeout: 120_000, // 2 min per scenario — kan göra många klick + db-ops
  expect: { timeout: 10_000 },
  fullyParallel: false, // delar samma DB → seriellt
  retries: 0,           // lokalt: misslyckas tidigt så vi ser orsaken
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: path.join(projectRoot, "reports/playwright-scenarios") }],
  ],
  outputDir: path.join(projectRoot, "reports/playwright-scenarios-results"),
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Anta att Next dev-server redan körs. Lokal workflow startar den
  // separat (yarn dev:next eller via docker-compose).
  webServer: {
    command: "yarn dev:next --hostname 0.0.0.0",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 180_000,
    env: {
      DATABASE_URL: "postgresql://ava:ava_dev_password@localhost:5432/ava?schema=public",
      MEILI_URL: "http://localhost:7700",
      MEILI_MASTER_KEY: "ava_meili_dev_key",
      TIKA_URL: "http://localhost:9998",
      NEXTAUTH_SECRET: "dev-secret-change-in-production",
      NEXTAUTH_URL: "http://localhost:3000",
      NODE_ENV: "development",
    },
  },
});
