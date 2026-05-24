# AVA — Aktuell arkitektur (2026-05-24)

Denna fil är den **officiella översikten** över vad som körs idag och vart
vi är på väg. Detaljer i andra docs ligger för vidare läsning.

> **Tar du vid pågående self-hosted round-trip-arbete?** Läs
> [`roundtrip-handoff.md`](./roundtrip-handoff.md) — det är den färska,
> implementationsnära statusen (browser↔lokal git-server, OPFS-runtime,
> dynamisk routing, e2e-harness, kvarvarande arbete).

## Mål: tunn server, tjock klient

```
┌──────────────────────────────────────────────┐
│  Browser-klient (FSA + isomorphic-git)        │
│    • All CRM-logik, sökindex, dokumenthantering│
│    • Lokal FSA-mappad mapp = working copy      │
│    • git operations via api.github.com REST    │
│      eller (via lokal helper) SSH till Tier 3  │
└──────────┬───────────────────────────────────┘
           │
   ┌───────┴───────┐
   │               │
   ▼               ▼
┌─────────┐  ┌──────────┐
│ nginx   │  │ sshd     │
│ :8080   │  │ :2222    │
│         │  │          │
│ static  │  │ bare git │
│ web-app │  │ repos    │
└─────────┘  └──────────┘
        Linux-server / Cleura
        (tunn — inget app-state)
```

## Tre deploy-lägen

| Läge | Server | Klient | Datalagring | Status |
|---|---|---|---|---|
| **Demo** | GitHub Pages | Browser (FSA, om man vill) | Publikt git-repo `ulrik-s/ava-demo` | ✅ Live |
| **Tier 3 self-hosted** | nginx + sshd | Browser eller Tauri | Bare git-repo på firmans server | ✅ Lokalt via docker-compose |
| **Tier 2 server-baserad** | Next.js + Postgres | Browser | PostgreSQL | 🚧 Endast för utveckling |

## Vad körs i `tooling/docker/docker-compose.yml`

Tunn variant — speglar Tier 3:

| Service | Port | Vad |
|---|---|---|
| `web` | 8080 | nginx servar `out/` (statisk Next.js-export) under `/ava/` **+ smart-HTTP git (`git-http-backend`) under `/git/`** |
| `git-ssh` | 2222 | sshd + bare git-repo (`firma.git`) |

Både `web` och `git-ssh` mountar samma `git_repos`-volym, så samma bare-repo
(`/srv/git/firma.git`) nås över **HTTP** (`http://localhost:8080/git/firma.git`)
och **SSH** (`ssh://git@localhost:2222/srv/git/firma.git`). HTTP-vägen finns för
att browser-klienten (isomorphic-git) ska kunna klona/pusha utan SSH — och
eftersom `/git/` ligger på samma origin som `/ava/` behövs **ingen CORS-proxy**.
Det är denna väg lokala round-trip- och e2e-tester använder.

Bygg + starta:

```bash
DEMO_BASE_PATH=/ava bash tooling/scripts/build-demo.sh
docker compose -f tooling/docker/docker-compose.yml up -d --build
# → http://localhost:8080/ava/
# → ssh://git@localhost:2222/srv/git/firma.git
```

## Dev-stacken (inte production)

För utveckling och scenario-tester finns en separat fat stack i
`docker-compose-dev.yml` (om vi behåller den) — postgres + meili + tika +
Next.js dev-server. Den är **inte** vad användarna kör.

## Klient-arkitektur

`src/client/components/demo-bootstrap.tsx` är entry-point för web-builden:

1. Läser `firma-config` (lokalt sparad i IndexedDB)
2. Klonar publikt demo-repo (om sådant) eller bygger upp från lokal FSA
3. Mountar `AuthProvider` + `SyncProviderRoot` + `DemoModeProvider`
4. Renderar appen + globala badges (auth, sync, jobs)

Klientens datalager-stack:

```
React UI
  ↕  trpc.useQuery / useMutation
DemoDataStore (Prisma-subset, in-memory)
  ↕  WritableDelegate (mutation events)
FSA-write-back (skriver JSON till FSA-mounted folder)
  ↕  git-add/commit/push
isomorphic-git
  ↕  api.github.com REST  (eller SSH via lokal helper)
GitHub (eller firmans Tier 3-server)
```

## Lokal SSH-server för utveckling

`tooling/docker/git-ssh/` innehåller en minimal Alpine-baserad sshd-image. Den
används för att testa Tier 3-flödet utan att deploya en faktisk server:

```bash
# Lägg din nyckel
cat ~/.ssh/id_ed25519.pub >> docker/git-ssh/authorized_keys

# Containern startar med docker compose up
# Klienter kan klona/pusha via:
ssh://git@localhost:2222/srv/git/firma.git
```

Detaljer: [`tooling/docker/git-ssh/README.md`](../docker/git-ssh/README.md).

## Push/pull-flödet från browser

Browser kan inte SSH:a direkt (ingen rå TCP-socket). Tre vägar:

1. **GitHub REST** — pushar/pullar via api.github.com med PAT eller OAuth-token
   ([`pull-via-rest.ts`](../src/client/lib/sync/github-rest/), körs idag)
2. **Tauri-app** — libgit2 inbyggd, SSH fungerar direkt
3. **Lokal helper-agent** — daemon på user:ns dator som tar HTTP-requests
   från browser:n och translaterar till SSH-git ([`local-helper-design.md`](./local-helper-design.md))

För Tier 3-mode med self-hosted git-server används väg 2 eller 3.
För publika github-repos används väg 1.

## Identitet (planerad)

Gerrit-style användare:

- Användarposter i `users/<id>.json` i firma-repo:t (commit-historik = audit)
- Privata SSH-nycklar lever bara på user:ns enheter (WebCrypto Ed25519)
- Publika nycklar i `users/<id>.json` + registrerade på SSH-servern
- Inget centraliserat login — autentisering via SSH-key-pair-signering

Designdetaljer: [`auth-and-integrations-design.md`](./auth-and-integrations-design.md).

## Tester

- **Unit + komponent (vitest)**: ~1500 tester, ~3% av filer otestade
- **Scenario (Playwright)**: 12 scenarier i `test/e2e/scenarios/` mot dev-stack
- **Smoke (Playwright)**: testar att demo-deploy:n inte 404:ar
- **CI**: `yarn test:all` kör allt — typecheck + lint + build + demo-build + vitest + e2e

Migrationsplan: scenario-testerna kör idag mot dev-stacken (Postgres).
När den tunna modellen är allt-in ska de portas till att köra mot
nginx + lokal FSA-emulation i Playwright.

## Designprinciper

1. **Tjock klient, tunn server** — all kapacitet finns i browser:n (FSA,
   IndexedDB, WebCrypto, WebLLM). Servern är dumb storage.
2. **Git som källa-till-sanning** — alla mutationer = commits. Hela
   historiken sparad. Branching/rollback gratis.
3. **Local-first** — appen ska fungera offline. Sync är best-effort,
   inte krav.
4. **Privacy by design** — klientdata stannar i firmans privata repo
   eller lokalt FSA. Ingen central server ser data.
5. **TDD + DRY + SOLID** — varje line of code ska ha minst ett test
   som täcker den. Helpers delas mellan tester (`test/helpers/`).
   Interfaces först, implementations efter.
