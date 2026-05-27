/**
 * dependency-cruiser regler för AVA.
 *
 * Mål:
 *   - Inga cirkulära imports (fångar dålig modulisering)
 *   - Inga "föräldraknark" — tester får importera prod-kod, ej tvärtom
 *   - Inga orphan-moduler (filer ingen importerar — kandidater för bortrensning)
 *
 * Kör: `yarn deps:check`
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Cirkulära beroenden indikerar dålig modulisering. Bryt cykeln.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment:
        "Modul som ingen importerar — antingen oanvänd (ta bort) eller saknad referens.",
      from: {
        orphan: true,
        pathNot: [
          "(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$",
          "\\.d\\.ts$",
          "(^|/)tsconfig\\.json$",
          "(^|/)(eslint|vitest|playwright|next|tailwind|postcss|prisma)\\.config\\.[a-z]+$",
          "(^|/)(eslint|vitest|playwright|next|tailwind|postcss|prisma)\\.setup\\.[a-z]+$",
          "(^|/)tooling/scripts/.+",
          "(^|/)test/.+",
          "src/app/.+/(page|layout|loading|error|not-found|route)\\.tsx?$",
          "src/shared/types/.+\\.d\\.ts$",
          "src/middleware\\.ts$",
        ],
      },
      to: {},
    },
    {
      name: "no-deprecated-core",
      severity: "warn",
      from: {},
      to: { dependencyTypes: ["deprecated"] },
    },
    {
      name: "no-test-imports-from-prod",
      severity: "error",
      comment: "Produktionskod får inte importera testfiler.",
      from: { pathNot: "\\.test\\.tsx?$" },
      to: { path: "\\.test\\.tsx?$" },
    },
    {
      name: "no-non-package-json",
      severity: "error",
      comment: "Importer av paket som inte finns i package.json.",
      from: {},
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"] },
    },
    {
      // ADR 0001: backend-pluggbarhet. Git-backendens cache/sök-internals
      // (in-memory content-cache, in-process search-index, klient-sidig
      // text-extraktion) FINNS INTE i Postgres-läget. Kontrakt-lagret
      // (IDataStore/IPorts-interfaces, routrar, shared) och en framtida
      // server/Postgres-backend MÅSTE gå via IPorts.searchIndex-porten och
      // får ALDRIG importera dessa git-moduler direkt.
      // (GitBackendRuntime/buildGitPorts FÅR — de ÄR git-backendens wiring.)
      name: "no-git-cache-in-contracts",
      severity: "error",
      comment:
        "Kontrakt-lagret + framtida Postgres-backend får inte importera git-" +
        "backendens cache/sök-internals (document-content-cache, demo-search-" +
        "index, jobs/extract-text). Gå via IPorts.searchIndex-porten (ADR 0001).",
      from: {
        path: [
          "^src/lib/server/data-store/IDataStore\\.ts$",
          "^src/lib/server/ports\\.ts$",
          "^src/lib/server/routers/",
          "^src/lib/shared/",
          "^src/lib/server/data-store/postgres/",
        ],
      },
      to: {
        path: [
          "^src/lib/client/demo/document-content-cache\\.ts$",
          "^src/lib/server/adapters/demo-search-index\\.ts$",
          "^src/lib/client/jobs/extract-text",
        ],
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: {
      path: [
        "(^|/)\\.next(/|$)",
        "(^|/)node_modules(/|$)",
        "(^|/)reports(/|$)",
        "(^|/)storage(/|$)",
        "(^|/)src/shared/generated(/|$)",
      ],
    },
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
      mainFields: ["main", "types"],
    },
    reporterOptions: {
      dot: { collapsePattern: "node_modules/(@[^/]+/[^/]+|[^/]+)" },
      archi: {
        collapsePattern:
          "^src/(app|client/components|client/lib|server/routers|server/data-store|server/local-first|shared/(schemas|types))",
      },
    },
  },
};
