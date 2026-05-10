/**
 * dependency-cruiser regler för AVA.
 *
 * Mål:
 *   - Inga cirkulära imports (fångar dålig modulisering)
 *   - Inga "föräldraknark" — tester får importera prod-kod, ej tvärtom
 *   - Layer-separation: UI-komponenter får inte importera prisma direkt
 *   - Inga orphan-moduler (filer ingen importerar — kandidater för bortrensning)
 *
 * Kör: `npx depcruise --config .dependency-cruiser.cjs src`
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
          "(^|/)scripts/.+",
          "(^|/)test/.+",
          "src/app/.+/(page|layout|loading|error|not-found|route)\\.tsx?$",
          "src/types/.+\\.d\\.ts$",
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
      name: "ui-not-direct-prisma",
      severity: "error",
      comment:
        "UI-komponenter (src/components, src/app) ska INTE importera prisma direkt — använd tRPC.",
      from: { path: "^src/(components|app(?!/api))" },
      to: { path: "^src/server/db(\\.ts)?$" },
    },
    {
      name: "ui-not-server-services",
      severity: "error",
      comment:
        "UI-komponenter ska inte importera server-services direkt; gå via tRPC.",
      from: {
        path: "^src/(components|app(?!/api))",
        pathNot: ["\\.test\\.tsx?$"],
      },
      to: { path: "^src/server/services/" },
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
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: {
      path: [
        "(^|/)\\.next(/|$)",
        "(^|/)node_modules(/|$)",
        "(^|/)reports(/|$)",
        "(^|/)storage(/|$)",
        "(^|/)src/generated(/|$)",
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
          "^src/(app|components|server/routers|server/services|server/db|lib|types)",
      },
    },
  },
};
