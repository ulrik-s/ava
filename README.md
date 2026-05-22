# AVA — Advokat-CRM

Local-first CRM för advokatbyråer. All klientdata stannar i webbläsaren
(demo-läge), firmans privata git-repo (skarp användning), eller på en
self-hosted Linux-server (Tier 3). Inga centraliserade backends.

## Kom igång

```bash
yarn install
yarn dev
```

Öppna http://localhost:3000.

## Lokal test-pipeline

Speglar exakt vad CI gör — kör allt på ett bräde:

```bash
yarn test:all            # hela stacken inkl. Playwright e2e (kräver Docker)
yarn test:all --no-e2e   # snabb feedback (~1 min): skippar docker + e2e
```

Pipeline:n kör i ordning:

1. **Static analysis** — typecheck, lint, deps:check (cykeldetektion),
   duplicates (jscpd), knip (dead code)
2. **`yarn build`** — production Next.js-build
3. **`scripts/build-demo.sh`** — statisk export för GH Pages
4. **Docker services** — postgres + meilisearch + tika + llm (om e2e ingår)
5. **Vitest** — ~1500 unit + komponent + integration-tester med coverage
6. **Playwright e2e** — smoke-tester mot demo-deployen
7. **Rapporter** — coverage, jscpd, playwright (HTML i `reports/`)

### Individuella lager

```bash
yarn typecheck          # tsc --noEmit
yarn lint               # eslint
yarn test:run           # vitest
yarn test:cov           # vitest med coverage
yarn test:fast          # vitest utan e2e/scripts
yarn build              # next build
bash scripts/build-demo.sh  # GH Pages-export
```

## Demo-läge

Demo-builden använder ett publikt git-repo som datakälla — ingen server.
Kör mot live-demo:

https://ulrik-s.github.io/ava

## Architecture

- **Demo build** (`NEXT_PUBLIC_DEMO_BUILD=1`) → GH Pages, in-memory store
  populerad från publikt git-repo + FSA-mount för local writes
- **Full build** (default) → Next.js med Postgres + Prisma backend
- **Tauri build** → desktop-app med libgit2 + OS-keychain för secrets

Designdokument finns i `docs/`:
- `architecture-future.md` — målarkitekturen
- `auth-and-integrations-design.md` — användardatabas + O365/OAuth
- `test-and-tooling-status.md` — testtäckning + tooling-historik

## CI

`.github/workflows/ci.yml` kör samma steg som `yarn test:all` i tre
parallella jobs. `deploy-demo.yml` deployer GH Pages efter varje
push till main.
