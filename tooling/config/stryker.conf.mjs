// @ts-check
/**
 * Mutationstestning av domänkärnan (pilot). Stryker ändrar koden lite i taget
 * (`>` → `>=`, `true` → `false`, tar bort ett anrop …) och kör testerna som når
 * raden. Överlever en ändring testar ingen den raden på riktigt — täckningen
 * mäter bara att raden KÖRS, inte att resultatet kontrolleras.
 *
 * Kärnan är koden där ett fel kostar pengar eller ett datum: taxor,
 * kostnadsräkning, moms, verifikat, fakturornas tillstånd och kalenderdagar.
 *
 *   bun run mutation        # rapport i reports/mutation/mutation.html
 *
 * `@hughescr/stryker-bun-runner` kör `bun test` med täckning per test, så varje
 * mutant kör bara de tester som når den (kräver Bun >= 1.4). `--isolate`: som
 * i resten av sviten läcker annars mock.module mellan filerna.
 */
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  appendPlugins: ["@hughescr/stryker-bun-runner"],
  testRunner: "bun",
  mutate: [
    "src/lib/shared/invoice-state-machine.ts",
    "src/lib/shared/vat.ts",
    "src/lib/shared/iso-date.ts",
    "src/lib/shared/stockholm-time.ts",
    "src/lib/shared/deadline.ts",
    "src/lib/shared/forordnandetaxa.ts",
    "src/lib/shared/brottmalstaxa.ts",
    "src/lib/shared/kostnadsrakning.ts",
    "src/lib/shared/rattshjalp.ts",
    "src/lib/shared/accounting/semantic-voucher.ts",
  ],
  bun: {
    // Där kärnans tester finns (de importerar modulerna ovan direkt).
    testFiles: ["test/unit/shared", "test/unit/lib", "test/unit/server/billing", "test/unit/server/integrations", "test/unit/server/routers"],
    bunArgs: ["--isolate"],
    timeout: 300_000,
  },
  // Router-testerna tar sekunder att ladda: med standardgränsen (5 s) fick mutanter
  // timeout i stället för en dom, och timeout räknas som fångad — poängen blev för hög.
  timeoutMS: 60_000,
  // Sandlådan kopierar projektet; bygget, rapporterna och de andra paketen behövs inte.
  ignorePatterns: ["out", ".next", "dist", "reports", "helper-ui", "office-addin", "test/e2e", "docs"],
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/mutation.html" },
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  // RATCHET (docs/quality.md): golvet ligger strax under dagens poäng (84,41 %,
  // 2026-11-18) och höjs bara. Under golvet fäller körningen.
  thresholds: { high: 90, low: 84, break: 84 },
  tempDirName: ".stryker-tmp",
  cleanTempDir: true,
};
