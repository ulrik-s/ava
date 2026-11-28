# Kvalitets-baslinje

Senast mätt: 2026-05-09 efter omfattande TDD-pass.

## Resultat per verktyg

### TypeScript (`npm run typecheck`)
✅ **0 fel** över hela trädet.

### ESLint (`npm run lint`)
- 0 errors, 48 warnings (varav 17 `max-lines-per-function`, 20 `complexity`, resten dead-code/oanvända vars).
- Nya `complexity`/`max-depth`/`max-lines-per-function`/`max-params` regler aktiva.
- Tidigare baseline (post-TDD-pass) hade 67 warnings (27 `max-lines-per-function`, 29 `complexity`).
  Refaktorerings-pass extraherade per-domain-helpers och underscore-prefixade
  child-komponenter i `_contacts-section.tsx`, `_time-section.tsx`,
  `_expense-section.tsx`, `_generate-modal.tsx`, `_payment-modal.tsx`,
  `_plan-modal.tsx`, `_credit-modal.tsx`, `_invoice-actions.tsx`,
  `_payments-table.tsx`, `_folder-row.tsx`, `_document-row.tsx`,
  `_new-folder-form.tsx`, `_drag-helpers.ts`, `_user-form.tsx`,
  `_suggestion-row.tsx`. WebDAV-handlers splittades per HTTP-metod.
  `analyzeDocument` delades upp i `loadDocumentText` + `callLlmForAnalysis`
  + `persistAnalysisResults`-pipeline. Kvarvarande warnings är i sidor som
  inte var prioriterade i pass:et (ContactsPage, SettingsPage, MattersContent
  m.fl.) och i WebDAV-funktioner med komplexitet 13–17 där ytterligare
  uppdelning skulle skada läsbarheten.

### Vitest + V8 coverage (`npm run test:cov`)

**801 tester** över 59 testfiler — alla passerar. Testfilerna ligger i ett
separat `test/`-träd (`test/unit/...` speglar `src/`, `test/scripts/`
mirrors `scripts/`, `test/e2e/` håller Playwright-sviten).

| Mått | Värde | Tröskel | Mål 3 mån |
|---|---|---|---|
| Statements | **84.31%** (2167/2570) | 82 | 90 |
| Branches | **78.75%** (1427/1812) | 77 | 90 |
| Functions | **84.36%** (561/665) | 81 | 90 |
| Lines | **86.74%** (1964/2264) | 84 | 90 |

#### Test-fördelning

- **Routers** (matter, user, contact, expense, timeEntry, conflict, reports, invoice, document/core, document/folders, document/suggestions): full CRUD + cross-org-spärr-tester
- **Services** (email, meilisearch, tika, document-analysis): mockad fetch/nodemailer
- **Lib** (utils, labels, contact-dedup, suggestion-grouping, template-context, auth, invoice-calc): unit-tester med edge cases
- **Komponenter** (sidebar, auth-guard, document-browser, invoices-section, payment-method-card, suggestions-panel, events-panel, providers, template-editor): jsdom + Testing Library
- **App-sidor** (alla page.tsx i src/app utom layout): renders + form-flöden + interaktioner
- **Scripts** (webdav-server.ts inkl. atomic-save-rescue): integration-tester med riktig HTTP-server
- **Skip:t**: `src/server/services/document-analysis.ts` har 53% — kvarvarande är edge cases för LLM JSON-repair (testat i `src/server/services/document-analysis.test.ts`).

### jscpd duplikatdetektering
- **3.94% duplicerat** (679 / 17 252 rader) — tröskel 4.5%.
- Mål: refaktorera ner till 1.5%.

### dependency-cruiser arkitekturregler
✅ **0 fel, 0 varningar** (0 cirkulära beroenden, 0 förbjudna lager-importer).

### knip (oanvänd kod)
- 5 unused dependencies, 3 unused devDependencies, 11 unused exports, 5 unused exported types
- Kvarvarande är mestadels labels-bakåtkompat-aliaser (medvetna).

## Funna och fixade buggar via TDD

1. **A11Y: labels saknar htmlFor** — login-formuläret fixat. `reports/A11Y-DEBT.md` listar resterande forms.
2. **WebDAV NFC/NFD-bugg** — fixat. Rescue-test för aborterad atomic save.
3. **React useEffect cascading-renders** i reports-sidan — refaktorerat till derivat-state.
4. **Open-route normaliserade inte NFC** — fixat så svenska tecken i path fungerar i alla browser-paths.
5. **Prisma-klient out-of-sync efter schema-ändring** — dokumenterat i README att `prisma generate` måste köras efter schema-ändring.

## Tröskelhöjningens regel

`vitest.config.ts → coverage.thresholds` är nu satt till:

```
statements: 82
lines: 84
functions: 81
branches: 77
```

Varje PR som lägger till tester ska höja minst en tröskel. Pull requests som
sänker täckningen blockeras av CI.

## Hur kvalitetsstacken körs

| Kommando | Vad |
|---|---|
| `npm run test:fast` | bara unit + komponenttester (< 60s, ≈ 8s i praktiken) |
| `npm run test:full` | drar igång docker compose + kör allt inkl. E2E |
| `npm run quality:fast` | typecheck + lint + test:fast |
| `npm run quality` | full pipeline med coverage, jscpd, deps, knip |
| `npm run test:cov` | bara tester + coverage-rapport (HTML i `reports/coverage/`) |
| `npm run test:ui` | interaktiv vitest-UI |
| `npm run e2e` | Playwright E2E |
| `npm run duplicates` | jscpd |
| `npm run deps:check` | dependency-cruiser |
| `npm run knip` | död kod / oanvända exporter |

All verktygskonfig bor i `config/`-mappen i roten (eslint, vitest, playwright,
jscpd, knip, dependency-cruiser). Endast filer som måste ligga i roten
(`next.config.ts`, `postcss.config.mjs`, `tsconfig.json`, `prisma.config.ts`)
finns kvar där.
