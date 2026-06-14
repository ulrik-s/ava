import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const projectRoot = path.resolve(__dirname, "..", "..");

/**
 * OIDC-e2e (#222): kör den RIKTIGA browser-inloggningen mot en RIKTIG IdP
 * (Keycloak, realm "ava" med test-användare) genom oauth2-proxy-stacken.
 * Verifierar hela token-dansen (redirect → Keycloak-login → callback →
 * session-cookie → /oauth2/userinfo) som inte går att skripta mot en mock.
 *
 * Krav (externt, sköts av tooling/scripts/e2e-oidc.sh): OIDC-overlayen uppe
 * (web + oauth2-proxy + keycloak) + `out/` byggd. Web på AVA_WEB_PORT (8088),
 * Keycloak på KC_PORT (8089).
 *
 * Kör: bun run e2e:oidc
 */
export default defineConfig({
  testDir: path.join(projectRoot, "test/e2e/oidc"),
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: path.join(projectRoot, "reports/playwright-oidc") }],
  ],
  outputDir: path.join(projectRoot, "reports/playwright-oidc-results"),
  use: {
    baseURL: process.env.AVA_OIDC_BASE_URL ?? "http://localhost:8088",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
