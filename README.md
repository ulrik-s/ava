# AVA — CRM för svenska advokatbyråer

> **USP**: Svenska byråer, svenska tjänster. **Din data, du bestämmer.**
> Browser är runtime. Servern är så tunn det går.

```
┌─────────────────────────────────────────────────────────────┐
│  Browser-app (Next.js 16 + tRPC, in-memory DemoDataStore)  │
│  ├─ Demo-mode: läser från GitHub Pages CDN                  │
│  └─ Self-hosted: clone:ar git-repo till OPFS, push:ar       │
└─────────────────────────────────────────────────────────────┘
                          ▲ HTTPS
┌─────────────────────────────────────────────────────────────┐
│  Server (val 1 av 2)                                        │
│  ├─ GitHub Pages: statiska filer (app + data)               │
│  └─ Linux/docker: nginx + git-http-backend + sshd           │
│     (inget custom kod-skikt att underhålla)                 │
└─────────────────────────────────────────────────────────────┘
```

## Funktioner

| Modul | Innehåll |
|---|---|
| **Ärenden** | CRUD, klient + motpart + domstol, dokumentträd, generera dokument från Handlebars-mall |
| **Kontakter** | Personer, företag, domstolar, försäkringsbolag, advokatbyråer, myndigheter |
| **Kalender** | Multi-user med färgkod, dag/vecka/månadsvy, Outlook-mirror (opt-in via O365-connector) |
| **Tasks** | TODO/IN_PROGRESS/DONE per advokat |
| **Tid + utlägg** | Per-ärende registrering, debiterbar-flagga, periodrapporter |
| **Fakturor** | DRAFT/SENT/PAID/INSTALLMENT_PLAN, acconto/slutfaktura/credit, betalningshistorik |
| **Avbetalningsplaner** | ACTIVE/COMPLETED/CANCELLED, progress-vy, reminders |
| **Dokument** | PDF/DOCX uppladdning + text-extraktion + fulltextsök (wildcards `*`) |
| **Mallar** | Handlebars-baserade dokumentmallar |
| **Jävskontroll** | Fuzzy namnsök + personnummer-substring mot alla matter-contacts |
| **AI (opt-in)** | In-browser LLM (Llama 3.2 via WebGPU) för dokumentklassificering |
| **Användare** | 5+ per byrå, ADMIN/LAWYER/ASSISTANT-roller |

## Kom igång

### Demo (GitHub Pages)

Surfa till den deployade demon. Det är read-only — ändringar lever bara i fliken.

Bygg + deploya egen demo:

```bash
yarn install
# CI sköter detta vid push till main: .github/workflows/deploy-demo.yml
# Manuellt:
DEMO_BASE_PATH=/ava bash tooling/scripts/build-demo.sh
# → out/ innehåller statisk app + manifest.json + 40 PDF/DOCX
```

### Self-hosted (Linux + docker)

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
tooling/scripts/add-user.sh bjorn@firma.se
```

Se [`docs/auth.md`](./docs/auth.md) för auth-modellen.

### Dev-server (mot lokal docker)

```bash
yarn install
docker compose -f tooling/docker/docker-compose.yml up -d
yarn dev
# Browser: http://localhost:3000
# (firma-config defaultar till http://localhost:8080/git/firma.git)
```

### Seed-data för byrån

```bash
yarn seed:local
# → pushar 5 users, 17 contacts, 15 matters, 40 PDF/DOCX,
#   7 avbetalningsplaner, 20 payments, 25 kalender-events
#   till docker-firma.git
```

## Arkitektur i kort

- **Ingen databas**. All data är JSON-rader + binärfiler i ett git-repo.
- **Ingen NextAuth, ingen Prisma, ingen Tauri**. Pivot bort från dessa.
- **Browser pratar inte med en backend** — tRPC routrar körs in-process via `demo-trpc-link`.
- **Git smart-HTTP** är enda lager mellan browser och server-disk. Allt via `isomorphic-git`.
- **OPFS** (Origin Private File System) håller en lokal working copy. Inga fil-väljardialoger.
- **Single source of truth för seed-data**: `tooling/scripts/seed-data.ts`. Samma fabrik bygger docker firma.git OCH gh-pages-demon.

Detaljer: [`docs/architecture.md`](./docs/architecture.md).

## Test + kvalitet

```bash
yarn test:fast           # ~1646 tester, ~14s
yarn typecheck           # tsc --noEmit
yarn lint                # eslint
yarn round-trip          # E2E mot docker (kräver docker upp)
```

Se [`docs/quality.md`](./docs/quality.md) för verktyg och tröskelvärden.

## Deploy

- [`docs/deploy-demo.md`](./docs/deploy-demo.md) — CI auto-seedad demo på GitHub Pages
- [`docs/deploy-tier3-self-hosted.md`](./docs/deploy-tier3-self-hosted.md) — Linux + docker-stack åt en byrå
- [`docs/auth.md`](./docs/auth.md) — htpasswd-baserad auth + PAT-rotation

## Skiljemål från andra CRM:er

- **Svensk domän**: matter-roller, betalningsmetoder (rättshjälp/rättsskydd/offentlig försvarare), BankID-redo
- **Data-suveränitet**: byrån äger git-repot. Vi äger ingen tjänst som kan stängas av åt dem.
- **Offline-AI**: LLM kör i browsern, dokument lämnar aldrig maskinen
- **Audit-vänligt**: varje state-ändring är en signerad git-commit med författare + tidsstämpel
