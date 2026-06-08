/**
 * dependency-cruiser regler för AVA.
 *
 * Mål:
 *   - Inga cirkulära imports (fångar dålig modulisering)
 *   - Inga "föräldraknark" — tester får importera prod-kod, ej tvärtom
 *   - Inga orphan-moduler (filer ingen importerar — kandidater för bortrensning)
 *
 * Kör: `bun run deps:check`
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
          // Webpack-stub (next.config NODE_STUB) — aliasas in i browser-
          // bundle:n via resolve.alias, importeras aldrig direkt. Per design
          // orphan i import-grafen.
          "(^|/)lib/shared/stubs/.+",
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
    {
      // Lager-gräns (docs/architecture.md §"Tre lager"): `shared` är delad kod
      // (Zod-scheman, domän-helpers) synlig för alla lager. Den får därför
      // INTE bero på vare sig UI- (`client`) eller backend-lagret (`server`) —
      // annars är den inte längre delbar. Enums/domänlogik som både client och
      // server behöver hör hemma här, inte i client/.
      name: "shared-must-not-import-up",
      severity: "error",
      comment:
        "src/lib/shared får inte importera från client/ eller server/. Flytta " +
        "delad kod (enums, domän-helpers) till shared istället för att låta " +
        "shared bero uppåt.",
      from: { path: "^src/lib/shared/" },
      to: { path: "^src/lib/(client|server)/" },
    },
    {
      // Lager-gräns: backendens kontrakt-/domänlager (routrar, data-store,
      // events, regler, auth, trpc) får inte bero på UI-lagret (`client`).
      // Undantag: git-backendens egen wiring (adapters/, local-first/) KÖR
      // klient-sidigt och får röra client-cachen — den gränsen vaktas i
      // stället av `no-git-cache-in-contracts` ovan.
      name: "server-contracts-must-not-import-client",
      severity: "error",
      comment:
        "Server-routrar/domänlogik får inte importera från client/. Ren " +
        "domänlogik som servern behöver hör hemma i shared/.",
      from: {
        path: "^src/lib/server/",
        pathNot: "^src/lib/server/(adapters|local-first)/",
      },
      to: { path: "^src/lib/client/" },
    },
    {
      // Lager-gräns: UI-lagret (app/, components/, lib/client) får referera
      // backend-lagret BARA via typer (tRPC `AppRouter`-kontraktet etc) —
      // aldrig dra in körbar server-kod. Undantag: composition-root:en där
      // backend faktiskt wire:as ihop in-process i browsern (browser ÄR
      // runtime, se architecture.md). Håll den listan kort.
      name: "ui-imports-server-by-type-only",
      severity: "error",
      comment:
        "UI-lagret får bara type-only-importera från server/ (tRPC-kontrakt). " +
        "Värde-importer av server-kod är tillåtna endast i composition-root: " +
        "lib/client/backend/, in-process-link, active-llm, demo-bootstrap, " +
        "app/demo/_demo-client.",
      from: {
        path: "^src/(app|components)/|^src/lib/client/",
        pathNot:
          "^src/(lib/client/(backend/|demo/in-process-link\\.ts$|llm/active-llm\\.ts$)|components/shell/demo-bootstrap\\.tsx$|app/demo/_demo-client\\.tsx$)",
      },
      to: {
        path: "^src/lib/server/",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      // Lager-gräns (docs/architecture.md §"Tre lager"): `shared` är delad
      // domänkod (Zod-scheman, rena helpers) som körs i ALLA lager — server,
      // klient, tester, build-skript. Den måste därför vara framework-agnostisk:
      // ingen import av react/next/@trpc. Ramverks-beroende kod hör hemma i
      // client/ (UI) eller server/ (tRPC), inte i shared/. (`shared-must-not-
      // import-up` vaktar grannskapet — egna lager; den här vaktar uppåt mot
      // npm-ramverken.) node_modules-löven react/react-dom/next/@trpc hålls
      // kvar i grafen av exclude-undantaget längst ned just för denna regel.
      name: "shared-must-be-framework-agnostic",
      severity: "error",
      comment:
        "src/lib/shared får inte importera react/react-dom/next/@trpc. Det är " +
        "framework-agnostisk delad domänkod (scheman, helpers) — lägg " +
        "ramverks-beroende kod i client/ eller server/.",
      from: { path: "^src/lib/shared/" },
      to: { path: "node_modules/(react|react-dom|next|@trpc)(/|$)" },
    },
    {
      // Kompositions-disciplin: varje top-level-router (`routers/<x>.ts`)
      // exporterar EN `xRouter` och komponeras ihop i `_app.ts`. Routrar får
      // inte importera varandra — det skapar implicit koppling, cykler och gör
      // att de inte längre går att resonera om/testa isolerat. Delad
      // domänlogik hör hemma i shared/ eller server-interna helpers, inte i en
      // grann-router. `_app.ts` är undantaget — det ÄR kompositionsroten.
      // (Subdir-filer som routers/document/core.ts är INTE top-level-routrar;
      // de matchar inte to-mönstret nedan och får komponeras fritt inom sin
      // modul — den gränsen vaktas av `router-internals-private`.)
      name: "routers-compose-via-app",
      severity: "error",
      comment:
        "tRPC-routrar får inte importera varandra. Komponera top-level-routrar " +
        "i routers/_app.ts; dela domänlogik via shared/ eller server-interna " +
        "helpers, inte via en grann-router.",
      from: {
        path: "^src/lib/server/routers/",
        pathNot: "^src/lib/server/routers/_app\\.ts$",
      },
      to: { path: "^src/lib/server/routers/[^/]+\\.ts$" },
    },
    {
      // Inga djupa cross-module-importer: en router som splittas i flera filer
      // lägger sina interna delar i en subdir (`routers/document/` →
      // core/folders/suggestions/events/shared). Den publika ytan är
      // kompositionsfilen `document.ts` (exporterar `documentRouter`); de
      // interna procedurgrupperna är privata. Bara `document.ts` + syskon inom
      // `document/` får importera dem — alla andra ska konsumera documentRouter
      // via _app, inte djupimportera interna grupper. Samma mönster gäller
      // varje framtida `routers/<x>/`-submodul (lägg till en rad per submodul).
      name: "router-internals-private",
      severity: "error",
      comment:
        "Djup cross-module-import förbjuden: routers/document/ är document-" +
        "routerns privata procedurgrupper. Bara document.ts (+ syskon i " +
        "document/) får importera dem; andra moduler går via documentRouter/_app.",
      from: { pathNot: "^src/lib/server/routers/document(/|\\.ts$)" },
      to: { path: "^src/lib/server/routers/document/" },
    },
  ],
  options: {
    // Följ type-only-imports (`import type`). Utan detta räknas inte type-
    // kanter, vilket (a) får rena interface-/typ-moduler (IDataStore, IPorts,
    // AuthProvider …) att felaktigt flaggas som orphans, och (b) gör att
    // lager-reglernas `dependencyTypesNot: ["type-only"]` inte kan urskilja
    // type- från värde-importer. Påslaget löser bådadera.
    tsPreCompilationDeps: true,
    doNotFollow: { path: "node_modules" },
    exclude: {
      path: [
        "(^|/)\\.next(/|$)",
        // node_modules utesluts ur grafen UTOM react/react-dom/next/@trpc.
        // De fyra hålls kvar som (icke-traverserade, via doNotFollow ovan)
        // löv-noder så att `shared-must-be-framework-agnostic` kan path-matcha
        // kanten src/lib/shared → ramverk. Övriga paket exkluderas som förr.
        "(^|/)node_modules/(?!(react|react-dom|next|@trpc)(/|$))",
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
