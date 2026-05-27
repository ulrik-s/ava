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
      // OBS: glob:arna måste matcha den nuvarande `src/lib/**`-layouten.
      // (Tidigare pekade de på `src/server/**`/`src/client/lib/**` som inte
      // längre finns efter omstruktureringen → coverage mätte 0 filer.)
      include: [
        "src/lib/**",
        "src/components/**",
        "src/app/**/page.tsx",
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
      //   - 1664 tester: Stmts 69.90%  Br 63.76%  Func 70.32%  Lines 72.47%
      //   - 1804 tester (2026-05-27): Stmts 68.01% Br 62.94% Func 67.99% Lines 70.05%
      //       NB: include-glob:arna pekade tidigare på den gamla (borttagna)
      //       `src/server/**`-layouten → coverage mätte 0 filer. Nu fixade till
      //       `src/lib/**` → siffrorna ovan är FAKTISK täckning över hela src/lib.
      //
      // Mål: 95% överallt. Kvarstående gap = i huvudsak fat React-komponenter
      // (firma-settings-panel, fsa-folder-selector, keypair-manager,
      // demo-bootstrap, profile/page) + crypto-modules (ed25519, sign-commit)
      // som kräver mer test-infrastruktur. Multi-session-arbete. Trösklarna
      // ligger strax under faktisk siffra → varje borttaget test syns som rött.
      thresholds: {
        statements: 67,
        lines: 69,
        functions: 67,
        branches: 62,
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
            "test/unit/shared/**/*.test.ts",
            "test/unit/app/api/**/*.test.ts",
            "test/scripts/**/*.test.ts",
            "test/integration/**/*.test.ts",
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
