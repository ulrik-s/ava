# AVA — Advokat-CRM

Local-first CRM för advokatbyråer med **tunn backend-arkitektur**.
All affärslogik kör i klientens browser (FSA + isomorphic-git).
Servern är två minimala lager: nginx för web-app:n + sshd för git-repos.

```
┌──────────────────────┐
│ Browser (tjock klient)│  ← all CRM-logik, FSA-mappad lokal disk
└──────────┬───────────┘
           │
           ├─ HTTPS → nginx :8080  ─ servar statiska web-app:n
           └─ SSH   → sshd  :2222  ─ bare git-repo = all datalagring
┌──────────────────────┐
│ Linux-server (tunn)   │  ← inget app-tillstånd, ingen DB
└──────────────────────┘
```

## Kom igång (lokal Tier 3-replica)

```bash
# 1. Lägg din SSH-nyckel
cat ~/.ssh/id_ed25519.pub >> docker/git-ssh/authorized_keys

# 2. Bygg static web-app
DEMO_BASE_PATH=/ava bash scripts/build-demo.sh

# 3. Starta stacken
docker compose up -d --build

# 4. Öppna i browser
open http://localhost:8080/ava/
```

Git push/pull från klienten: `ssh://git@localhost:2222/srv/git/firma.git`

## Arkitektur

| Komponent | Vad | Var |
|---|---|---|
| **Klient** | FSA + isomorphic-git, all CRM-logik, sökindex, dokumenthantering | Browser |
| **Web** | nginx servar statiska web-app:n (Next.js export) | Container/server |
| **Git** | sshd + bare repos = persistent datalagring | Container/server |
| **Identitet** | SSH ed25519-nycklar — autenticerar push/pull | Per-user, browser-genererade |

**Designprinciper:**
- Tjock klient, tunn server — browser har all kapacitet (FSA, IndexedDB, WebCrypto, WebLLM)
- Git som källa-till-sanning — alla mutationer = commits, hela historiken sparad
- Inga centraliserade backends — varje firma har sitt eget repo
- Privacy by design — klientdata stannar lokalt eller i firmans privata git

## Tre deploy-läger

1. **Demo (publik)** — `https://ulrik-s.github.io/ava` läser från publikt git-repo
2. **Lokalt (denna repo)** — docker-compose med nginx + sshd, för utveckling och egen byrå
3. **Tauri (desktop)** — native app med libgit2, för dem som vill slippa browser

## Lokal test-pipeline

Speglar exakt vad CI gör — kör allt på ett bräde:

```bash
yarn test:all            # hela stacken inkl. Playwright e2e (kräver Docker)
yarn test:all --no-e2e   # snabb feedback (~1 min): skippar docker + e2e
```

Pipeline:n kör i ordning: typecheck → lint → deps + duplicates + knip
→ Next.js-build → demo-build → Vitest + coverage → Playwright e2e.

### Scenario-tester (UI motionering)

`test/e2e/scenarios/` innehåller multi-step användarflöden:

| Fil | Vad |
|---|---|
| `01-skapa-arende-med-befintlig-klient` | Ärende-form + klient-koppling |
| `02-skapa-ny-klient-och-arende` | Skapa kontakt → ärende kopplar den |
| `03-oppna-arende-och-bladdra` | Lista + filter + detalj-vy |
| `04-tid-till-rapport` | Registrera tid → verifiera i Rapporter |
| `05-faktura-plan-betalning-avsluta` | Slutfaktura → plan → betalningar → PAID → avsluta |
| `06-acconto-och-slutfaktura` | Acconto → betalas → slutfaktura med avdrag |

Kör scenarier (kräver lokal dev-postgres för utveckling):

```bash
yarn scenarios            # docker-up + seed + alla 12 tester (~30s)
yarn scenarios:ui         # interaktiv Playwright-UI
```

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

## Komponentbibliotek (motionerade widgets)

| Komponent | Tester |
|---|---|
| AuthStatusBanner | 6 |
| SyncStatusPill (alla 7 states) | 10 |
| JobsBadge | 7 |
| FeatureUnavailable | 3 |
| RenderErrorBoundary | 3 |
| SyncDiagnostics | 8 |
| AutoSync | 2 |
| FirmaSettingsPanel | 5 |
| DocumentRow + upload-guard | 4 |
| MatterDetailPage | många |
| Reports | många |

## Designdokument

Mer detaljerade designdokument finns i `docs/`:

- [`architecture-future.md`](docs/architecture-future.md) — målarkitekturen
- [`auth-and-integrations-design.md`](docs/auth-and-integrations-design.md) — användardatabas + O365/OAuth
- [`test-and-tooling-status.md`](docs/test-and-tooling-status.md) — testtäckning + tooling
- [`docker/git-ssh/README.md`](docker/git-ssh/README.md) — Tier 3 SSH-server setup
- [`scripts/oauth-proxy/README.md`](scripts/oauth-proxy/README.md) — Cloudflare Worker för GitHub-OAuth

## CI

`.github/workflows/ci.yml` kör samma steg som `yarn test:all` i tre
parallella jobs. `deploy-demo.yml` deployer GH Pages efter varje push.
