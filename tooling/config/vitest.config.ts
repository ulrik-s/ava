import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-plugin-tsconfig-paths";
import react from "@vitejs/plugin-react";
import path from "node:path";

const projectRoot = path.resolve(__dirname, "..", "..");

/**
 * Vitest-konfig med tre projekt:
 *
 *   - "node"  : default-miljön; tester för server/lib/scripts
 *   - "jsdom" : komponenttester (DOM via jsdom + Testing Library)
 *
 * Coverage-tröskel håller oss ärliga: under tröskel = `vitest run` exit≠0.
 * Höj trösklarna stegvis när vi skriver fler tester.
 */
export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  root: projectRoot,
  test: {
    globals: true,
    setupFiles: [path.resolve(__dirname, "vitest.setup.ts")],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary", "lcov"],
      reportsDirectory: "./reports/coverage",
      include: [
        "src/client/lib/**",
        "src/server/routers/**",
        "src/server/services/**",
        "src/server/events/**",
        "src/server/rules/**",
        "src/server/data-store/**",
        "src/server/local-first/**",
        "src/client/components/**",
        "src/app/**/page.tsx",
        "tooling/scripts/webdav-server.ts",
      ],
      exclude: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.d.ts",
        "src/app/**/layout.tsx",
        "src/app/**/loading.tsx",
        "src/app/**/error.tsx",
        "src/app/**/not-found.tsx",
      ],
      // Baseline-trösklar — strax under nuvarande siffror så pipeline är grön
      // men varje PR som tar bort tester syns som rött.
      //
      // Historik (för att vi inte ska sjunka i smyg):
      //   - 801 tester:  Stmts 83.56%  Br 78.35%  Func 82.72%  Lines 85.47%
      //   - 1454 tester: Stmts 60.17%  Br 54.01%  Func 62.64%  Lines 62.46%
      //
      // 2026-05-22: stor tillförsel av UI- + FSA-beroende kod (jobs,
      // sync, keypair, integrations, github-rest, profile, users) som
      // kräver Playwright/FSA-mocks vi inte byggt än. Sänker tröskeln
      // till ny realistisk baseline. Höj ÅTERIGEN när vi byggt FSA-
      // testharness — då ska coverage gå upp, inte ner.
      //
      // Mål långsiktigt: 80%+ överallt. Just nu fokuserar vi på kvalitet
      // i pure-logic-modulerna (sync, jobs, github-rest, keys) som har
      // egna unit-tester.
      thresholds: {
        statements: 58,
        lines: 60,
        functions: 60,
        branches: 52,
      },
    },
    projects: [
      {
        plugins: [tsconfigPaths()],
        test: {
          name: "node",
          environment: "node",
          include: [
            "test/unit/lib/**/*.test.ts",
            "test/unit/server/**/*.test.ts",
            "test/unit/app/api/**/*.test.ts",
            "test/scripts/**/*.test.ts",
          ],
        },
      },
      {
        plugins: [tsconfigPaths(), react()],
        test: {
          name: "jsdom",
          environment: "jsdom",
          setupFiles: [path.resolve(__dirname, "vitest.setup.ts")],
          include: [
            "test/unit/components/**/*.test.tsx",
            "test/unit/app/**/*.test.tsx",
            "test/unit/lib/**/*.test.tsx",
          ],
        },
      },
    ],
  },
});
