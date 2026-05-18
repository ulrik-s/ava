import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-plugin-tsconfig-paths";
import react from "@vitejs/plugin-react";
import path from "node:path";

const projectRoot = path.resolve(__dirname, "..");

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
        "src/lib/**",
        "src/server/routers/**",
        "src/server/services/**",
        "src/server/events/**",
        "src/server/rules/**",
        "src/server/data-store/**",
        "src/server/local-first/**",
        "src/components/**",
        "src/app/**/page.tsx",
        "scripts/webdav-server.ts",
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
      // men varje PR som tar bort tester syns som rött. Aldrig sänk.
      // Aktuell baslinje (801 tester):
      //   Statements 83.56%, Branches 78.35%, Functions 82.72%, Lines 85.47%
      // Mål: 90% överallt (90% sätts som golv för nya routers/components).
      thresholds: {
        statements: 82,
        lines: 84,
        functions: 81,
        branches: 77,
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
          ],
        },
      },
    ],
  },
});
