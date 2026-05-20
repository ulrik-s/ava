# Test & tooling-status

Status per 2026-05-20. Detta dokument svarar på frågorna "vilka verktyg har vi", "vad är coverage", "vad saknas".

## Verktyg som redan finns

| Verktyg | Vad det gör | Status |
|---|---|---|
| **vitest** | Unit + integration tester, coverage via v8 | ✅ Konfigurerat |
| **@testing-library/react** | DOM-render-tester | ✅ Konfigurerat |
| **playwright** | End-to-end browser-tester | ⚠️ Installerat men få tester |
| **eslint** (Next.js + complexity-plugin) | Lint inkl. complexity ≤ 12, max-lines-per-function 100 | ✅ Pre-commit hook |
| **jscpd** | Duplicates / DRY-detection | ✅ `yarn duplicates` |
| **dependency-cruiser** | Modulär arkitektur (SOLID), cykler, kapsling | ✅ `yarn deps:check` |
| **knip** | Hittar oanvänd kod, exports, deps | ✅ `yarn knip` |
| **husky** + **lint-staged** | Eslint + typecheck vid commit | ✅ Aktiv |
| **tsx --strict** | TypeScript strict mode | ✅ |

Kör allt på en gång: `yarn quality`

## Coverage just nu (per 2026-05-20)

```
All files          |   66.75% statements  |  68.96% lines  |  68.15% functions  |  58.61% branches
```

**Tröskel-golv** i `config/vitest.config.ts`: statements 82, lines 84, functions 81, branches 77.

⚠️ **Aktuell coverage är UNDER trösklarna** för core stmts/lines (66.75 < 82). Trösklar är satta för före-refaktor-koden. Nya FSA/Tauri-komponenter saknar test-täckning.

## Var gapen ligger

### Stor gap (< 30% coverage, behöver tester)

| Fil | Coverage | Risk |
|---|---|---|
| `src/components/demo-bootstrap.tsx` | 1.21% | Kritisk — composition root |
| `src/components/firma-settings-panel.tsx` | 4% | UI för byta repo |
| `src/components/oauth-device-flow.tsx` | 1.92% | OAuth-flöde |
| `src/components/merge-conflict-panel.tsx` | 10% | Merge-konflikt UI |
| `src/components/render-error-boundary.tsx` | 14% | Felhantering |
| `src/components/tauri-git-sync.tsx` | 21% | Tauri sync |
| `src/components/web-fsa-git-sync.tsx` | 23% | Web FSA sync |
| `src/lib/firma/firma-config.ts` | 100% ✅ (efter Fas R17) | — |
| `src/lib/firma/fsa-write-back.ts` | 100% ✅ (efter Fas R17) | — |
| `src/lib/demo/static-params.ts` | 0% | Build-time, kör i Next.js |
| `src/lib/fsa/handle-store.ts` | (mockas i web-fsa-test) | Medium |

### Medium gap (50-80%)

- `src/components/document-browser.tsx` (64%) — komplex tabell-rendering
- `src/components/contacts-section.tsx` (75%)
- `src/components/auth-guard.tsx` (68%)
- Routrar (varierande)

### Bra (>90%)

- Alla `src/lib/`-helpers
- `src/app/page.tsx` (Dashboard) 100%
- Procedure-routrar
- Projection-classer

## Vägen till 95% — uppskattat arbete

| Område | Effort | Värde |
|---|---|---|
| FSA/Tauri-komponent-tester (act+screen.findByText etc.) | 8-12h | Hög — fångar bugs som "Cannot read .id" |
| Playwright smoke-test för varje route | 2-3h | Hög — fångar 404-bugs |
| Mutation-flöden via tRPC-link → DemoDataStore → fsa-write-back | 3h | Hög — integration |
| Dynamic [id]-routes (matters/[id], contacts/[id]) | 4h | Medium |
| Resterande lib/-helpers | 2h | Low |
| **Totalt** | **~20h** | |

## Min rekommendation framöver

1. **Höj trösklar gradvis** i stället för att kräva 95% direkt. Sätt floor till nuvarande nivå så regressioner fångas.
2. **Test-first för nya buggar** — skriv test innan fix. Vi har redan börjat med detta (writable-delegate, fs-adapter, url-rewrite).
3. **Smoke-tests först, unit-tests sen** — Playwright `expect(page).toHaveTitle()` för varje route fångar 80% av broken-pages-buggar med 20% av effort.
4. **Strikta lint-rules** redan på plats — eslint klagar på complexity > 12, max-lines > 100, vilket pushar SOLID.
