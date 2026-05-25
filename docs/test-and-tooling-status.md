# Test & tooling-status

Snapshot 2026-05-25. För konfig-detaljer, se [`quality.md`](./quality.md).

## Verktygskedja

| Verktyg | Vad det gör | Status |
|---|---|---|
| **vitest** | Unit + integration tester (node + jsdom projekt) | ✅ |
| **@testing-library/react** | DOM-render-tester | ✅ |
| **playwright** | End-to-end round-trip mot docker | ✅ (`yarn round-trip`) |
| **eslint** | Lint + komplexitet (cap @ 8) | ✅ pre-commit |
| **jscpd** | Duplicate detection (DRY) | ✅ `yarn duplicates` |
| **dependency-cruiser** | Cykler + lager-regler (SOLID) | ✅ `yarn deps:check` |
| **knip** | Oanvänd kod / exports | ✅ `yarn knip` |
| **husky + lint-staged** | Lint + typecheck vid commit | ✅ |
| **tsc --strict** | Typkontroll | ✅ |

Kör allt: `yarn quality`. Snabb-cykel: `yarn test:fast` (~14s, ~1646 tester).

## Aktuell testdistribution (~1646 tester)

- **Pure-helpers** (~50 testfiler): seed-data, color-palette, classify-document, fuzzy-similarity, calendar-grid-helpers, day-view-layout, auth-core, manifest-generator, llm-config, etc.
- **tRPC-routrar** (~25 testfiler): matter, contact, calendar, task, paymentPlan, invoice, document, conflict, timeEntry, expense, user, reports
- **Komponenter** (~40 testfiler): document-browser, firma-settings-panel, sync-diagnostics, jobs-badge, calendar-page, payment-plans-page, etc.
- **Sidor** (~20 testfiler): contacts/[id], matters/[id], invoices/[id], search, settings, users, templates, time, conflicts, reports
- **Integration** (`test/integration/seed-smoke.test.ts`): kör varje meny-sidas tRPC-procedurer mot riktig DemoDataStore + seed-datan. Skyddar mot regressioner i:
  - join-resolvering (documents.matter, matterContacts.contact/matter etc.)
  - org-scope (assertDocAccess, classifyDocument)
  - data-integritet (varje INSTALLMENT_PLAN-faktura har en ACTIVE-plan)
- **E2E** (`test/e2e/round-trip/`): browser pushar verkligen mot docker-firma.git via OPFS + iso-git

## Coverage-trösklar

I `tooling/config/vitest.config.ts`:

```ts
thresholds: {
  statements: 68,
  lines: 70,
  functions: 68,
  branches: 60,
}
```

Mål Task #5 är 95% överallt. Resterande gap är fat React-komponenter
(firma-settings-panel, document-browser, demo-bootstrap) och vissa
crypto-modules (ed25519, sign-commit) som kräver mer test-infrastruktur
(WebCrypto-mocks).

## CI

Två workflows:

- **`ci.yml`** — på varje PR: install + lint + typecheck + `test:fast` + duplicates + deps:check
- **`deploy-demo.yml`** — på push till main: bygger `out/` med app + seed + manifest, deployar till GH Pages

Båda kör Node 22. Se `.github/workflows/`.

## Snabbreferens

```bash
yarn test:fast               # unit + integration, ~14s
yarn test:run                # alla projekt inkl. scripts
yarn test:cov                # med coverage-rapport
yarn round-trip              # E2E mot docker (kräver docker up + out/)
yarn typecheck               # tsc --noEmit
yarn lint                    # eslint
yarn duplicates              # jscpd
yarn deps:check              # dependency-cruiser
yarn knip                    # död kod
yarn quality                 # alla ovan
```
