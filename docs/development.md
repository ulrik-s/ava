# Utvecklarguide

> Den här guiden vänder sig till den som ska köra, bygga eller vidareutveckla
> AVA. Som slutanvändare behöver du bara demolänken i [README](../README.md).

AVA är "git-first": **webbläsaren är runtime**, och all data lagras som JSON +
binärfiler i ett git-repo. Servern är så tunn det går. Två driftlägen:

```
┌─────────────────────────────────────────────────────────────┐
│  Browser-app (Next.js 16 + tRPC, in-memory DemoDataStore)  │
│  ├─ Demo-mode: läser från GitHub Pages CDN (read-only)      │
│  └─ Self-hosted: clone:ar git-repo till OPFS, push:ar       │
└─────────────────────────────────────────────────────────────┘
                          ▲ HTTPS
┌─────────────────────────────────────────────────────────────┐
│  Server (val 1 av 2)                                        │
│  ├─ GitHub Pages: statiska filer (app + data)               │
│  └─ Linux/docker: nginx + git-http-backend + sshd           │
└─────────────────────────────────────────────────────────────┘
```

## Arkitektur i kort

- **Ingen databas**. All data är JSON-rader + binärfiler i ett git-repo.
- **Ingen NextAuth, ingen Prisma, ingen Tauri**.
- **Browsern pratar inte med en backend** — tRPC-routrar körs in-process.
- **Git smart-HTTP** är enda lager mellan browser och server-disk (via `isomorphic-git`).
- **OPFS** (Origin Private File System) håller en lokal working copy.
- **Single source of truth för seed-data**: `tooling/scripts/seed-data.ts` — samma
  fabrik bygger docker-firma.git OCH gh-pages-demon.

Detaljer: [`architecture.md`](./architecture.md).

## Bygg + deploya demon

```bash
yarn install
# CI sköter detta vid push till main: .github/workflows/deploy-demo.yml
# Manuellt:
DEMO_BASE_PATH=/ava bash tooling/scripts/build-demo.sh
# → out/ innehåller statisk app + manifest.json + 40 PDF/DOCX
```

## Self-hosted (Linux + docker)

```bash
# 1. Bygg statisk export
DEMO_BASE_PATH=/ava bash tooling/scripts/build-demo.sh

# 2. Starta stack
docker compose -f tooling/docker/docker-compose.yml up -d

# 3. Hämta initial admin-PAT (skrivs en gång i loggen)
docker compose -f tooling/docker/docker-compose.yml logs web | grep "Admin-token"

# 4. Browser: http://localhost:8080/ava/setup → klistra in PAT

# 5. Lägg till fler advokater
tooling/scripts/add-user.sh anna@firma.se
```

Se [`auth.md`](./auth.md) för auth-modellen.

## Dev-server (mot lokal docker)

```bash
yarn install
docker compose -f tooling/docker/docker-compose.yml up -d
yarn dev
# Browser: http://localhost:3000
```

## Seed-data för byrån

```bash
yarn seed:local
# → pushar 5 users, 17 contacts, 15 matters, 40 PDF/DOCX,
#   7 avbetalningsplaner, 20 payments, 25 kalender-events till docker-firma.git
```

## Test + kvalitet

```bash
yarn test:fast           # ~2224 tester
yarn typecheck           # tsc --noEmit
yarn lint                # eslint (flat config)
yarn deps:check          # dependency-cruiser (lagergränser)
yarn knip                # död kod / oanvända deps
yarn round-trip          # E2E mot docker (kräver docker upp)
```

Se [`quality.md`](./quality.md) för verktyg och tröskelvärden, och
[`../AGENTS.md`](../AGENTS.md) för arbetssättet (Issue → PR → Merge).

## Deploy

- [`deploy-demo.md`](./deploy-demo.md) — CI auto-seedad demo på GitHub Pages
- [`deploy-tier3-self-hosted.md`](./deploy-tier3-self-hosted.md) — Linux + docker-stack åt en byrå
- [`auth.md`](./auth.md) — htpasswd-baserad auth + PAT-rotation
