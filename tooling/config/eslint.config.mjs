import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * ESLint-konfiguration med extra regler för kodkvalitet (alla HARD error):
 *   - complexity: cyklomatisk komplexitet ≤ 8 per funktion
 *   - max-depth: max 4 nivåer av nästade block
 *   - max-lines-per-function: 100 rader (200 i tooling/scripts/)
 *   - max-params: 5 parametrar per funktion
 *   - max-nested-callbacks: max 4 nästade callbacks
 *
 * Struktur-reglerna är `error`, inte `warn`: CI körs med `--max-warnings 0`
 * så NYA brott blockerar bygget. Befintlig skuld ligger som en baseline i
 * `eslint-suppressions.json` (genererad via `bun run lint:suppress`, en
 * ESLint-10-bulk-suppression) — den fungerar som ventil så orelaterat arbete
 * aldrig blockeras av gammal skuld, och betas av mekaniskt: när en lång
 * funktion refaktoreras kör `bun run lint:prune` bort dess post och filen krymper
 * i git. Se docs/quality.md ("max-lines-cap & ventil") och #41.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // ESLint 10-kompat: hårdkoda React-versionen. eslint-plugin-react
    // (buntad av eslint-config-next) auto-detekterar annars versionen via
    // context.getFilename(), som togs bort i ESLint 10 → krasch. Att ange
    // versionen explicit kringgår detekteringen (och är snabbare). Kan tas
    // bort när eslint-config-next buntar en ESLint-10-fixad eslint-plugin-react
    // (jsx-eslint/eslint-plugin-react#3979, vercel/next.js#91702).
    settings: { react: { version: "19.2" } },
  },
  {
    // Typ-medveten linting (#9). projectService låter typescript-eslint hitta
    // närmaste tsconfig.json per fil → ger typinfo till reglerna nedan.
    // Kostar lint-tid (~14s → ~21s) men möjliggör enforcement-golv som rent
    // syntaktiska regler inte kan uttrycka. tsconfigRootDir = repo-rot eftersom
    // ESLint annars förankrar mot tooling/config/.
    files: ["**/*.{ts,tsx,mts}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname + "/../..",
      },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      // consistent-type-imports tvingar `import type` för type-only-importer
      // → backar mekaniskt upp dependency-cruiser-regeln "UI importerar server
      // type-only" på källnivå (#9).
      "@typescript-eslint/consistent-type-imports": "error",
      // Ratchet (#47): all `any` eliminerad i src utom datalagrets flytande
      // query-yta (IDataStore.ts, block-disabled + dokumenterad). Skärper från
      // next/typescript:s `warn` → `error` så NYA `any` blockerar CI.
      "@typescript-eslint/no-explicit-any": "error",
      // Promise-säkerhet: oavsiktligt obevakade promises, async-callbacks i
      // synkron/void-kontext, och `await` på icke-thenables är vanliga
      // buggkällor som bara typinfo kan upptäcka (#9).
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      // Utvärderade men uppskjutna (#9): no-unnecessary-condition (~105 brott)
      // och strict-boolean-expressions (~529) är för stora för ett svep —
      // ratchas per katalog i uppföljnings-issue. Typinfon ovan är redan på, så
      // de tillkommer utan extra parser-overhead när de aktiveras.
      // Underscore-prefix = avsiktligt oanvänd (signaturkrav, framtida bruk).
      // Skiljer medvetna platshållare från faktiskt bortglömd kod.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      complexity: ["error", { max: 8 }],
      "max-depth": ["error", 4],
      "max-lines-per-function": [
        "error",
        { max: 100, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      "max-params": ["error", 5],
      "max-nested-callbacks": ["error", 4],
    },
  },
  {
    // Mjuka upp för testfiler — de tenderar vara längre med setup/teardown.
    files: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}", "test/**/*.{ts,tsx}"],
    rules: {
      "max-lines-per-function": "off",
      complexity: "off",
      // bun:test:s `expect(...).resolves/.rejects`-matchers är async i runtime
      // men typas som icke-thenable i bun-types → `await` ger falska positiv.
      // Stäng av för tester (vi await:ar dem medvetet) (#92).
      "@typescript-eslint/await-thenable": "off",
    },
  },
  {
    // Scripts har naturligt mer setup-kod.
    files: ["tooling/scripts/**/*.ts"],
    rules: {
      "max-lines-per-function": ["error", { max: 200 }],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "reports/**",
    ".claude/**",     // worktrees och personliga scratchfiler
    "src/shared/generated/**", // genererade Prisma-typer
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
