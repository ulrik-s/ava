import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * ESLint-konfiguration med extra regler för kodkvalitet:
 *   - complexity: cyklomatisk komplexitet ≤ 8 per funktion (HARD error)
 *   - max-depth: max 4 nivåer av nästade block
 *   - max-lines-per-function: 80 rader (mjuk gräns)
 *   - max-params: 5 parametrar per funktion
 *
 * Befintliga funktioner som överskrider 8 har explicita `eslint-disable`
 * + TODO så CI blockerar NYA brott. Se Task #6 i docs/roundtrip-handoff.md
 * för refaktoreringskö.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
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
      "max-depth": ["warn", 4],
      "max-lines-per-function": [
        "warn",
        { max: 100, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      "max-params": ["warn", 5],
      "max-nested-callbacks": ["warn", 4],
    },
  },
  {
    // Mjuka upp för testfiler — de tenderar vara längre med setup/teardown.
    files: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}", "test/**/*.{ts,tsx}"],
    rules: {
      "max-lines-per-function": "off",
      complexity: "off",
    },
  },
  {
    // Scripts har naturligt mer setup-kod.
    files: ["tooling/scripts/**/*.ts"],
    rules: {
      "max-lines-per-function": ["warn", { max: 200 }],
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
