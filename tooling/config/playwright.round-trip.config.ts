import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const projectRoot = path.resolve(__dirname, "..", "..");

/**
 * Git-round-trip e2e: kör den RIKTIGA browser-klienten mot docker-stacken
 * (nginx + git-http-backend på :8080) i self-hosted/OPFS-läge och
 * verifierar att UI-handlingar landar i bare-repo:t.
 *
 * Krav (externt): `docker compose -f tooling/docker/docker-compose.yml up -d --build` + `out/` byggd
 * (`DEMO_BASE_PATH=/ava bun run build`). Repo:t nås på
 * http://localhost:8080/git/firma.git (samma origin som /ava → ingen
 * cors-proxy).
 *
 * Kör: bun run playwright test --config tooling/config/playwright.round-trip.config.ts
 */
export default defineConfig({
  testDir: path.join(projectRoot, "test/e2e/round-trip"),
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  // 1 retry: hydrering av nyss-skapad data ur OPFS över sid-omladdningar har
  // en sällsynt timing-race; en omkörning (med ren resetRepo) är deterministisk.
  retries: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: path.join(projectRoot, "reports/playwright-round-trip") }],
  ],
  outputDir: path.join(projectRoot, "reports/playwright-round-trip-results"),
  use: {
    baseURL: process.env.AVA_RT_BASE_URL ?? "http://localhost:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
