# Server-runtime (git-peer)

> ADR 0005 fas 1. Bygger på #115 (läs) + #116 (skriv) + #117 (pull→act→push) och
> är den körbara artefakten från #118.

Server-runtimen är en **git-peer**, inte en dataägare (ADR 0005): den klonar
`firma.git`, kör mutationer mot sin egen working copy och pushar tillbaka —
exakt samma roll som en browser-klient. Den är komplementet som gör
integrationer (Fortnox, mail, regler) möjliga utan att bryta local-first-USP:n:
är servern nere köas integrationer, appen fungerar ändå.

## Köra

Config läses ur miljövariabler. Bara tre är obligatoriska:

| Env | Default | Beskrivning |
|-----|---------|-------------|
| `AVA_SR_REPO_URL` | — (obligatorisk) | remote-url till `firma.git` (`file://`, `https://`, `ssh`) |
| `AVA_SR_WORK_DIR` | — (obligatorisk) | katalog för working-copy:n (klonas hit om tom) |
| `AVA_SR_ORG_ID` | — (obligatorisk) | org-id för den self-deklarerade principalen |
| `AVA_SR_BRANCH` | `main` | branch att synka mot |
| `AVA_SR_REMOTE` | `origin` | git-remote-namn |
| `AVA_SR_POLL_INTERVAL_MS` | `15000` | polling-intervall |
| `AVA_SR_MAX_RETRIES` | `3` | push-försök vid konflikt per cykel |
| `AVA_SR_PRINCIPAL_ID` / `_EMAIL` / `_NAME` / `_ROLE` | `server-runtime` / … / `ADMIN` | principal + git-författare |

> **Git-creds** tas av systemets git-config/credential-helper (SSH-agent,
> HTTPS-helper) — precis som `NodeGitOps`/`cloneWorkingCopy`. Inga hemligheter
> skickas via env.

```sh
# Direkt via bun
AVA_SR_REPO_URL=https://host/git/firma.git \
AVA_SR_WORK_DIR=/srv/ava/wc \
AVA_SR_ORG_ID=byra-1 \
  bun run server-runtime

# En enda tick + avsluta (cron / smoke-test)
… bun run server-runtime --once

# Hjälp
bun run server-runtime --help
```

## Lägen

- **sync** (inget connector-`job` inkopplat ännu): varje tick gör `fetch` +
  hård reset till remote — håller working-copy:n à jour, pushar inget (inga
  tomma commits). Servern är en nyttig à-jour-peer redan innan första
  connectorn finns.
- **cykel** (när ett `job` injiceras, kommande #80/#82): varje tick kör en
  konflikt-säker `runPeerCycle` (pull → act → push, CAS-retry vid
  `NonFastForward`).

## Paketering

```sh
bun run server-runtime:build   # → dist/server-runtime/ava-server-runtime-<os>-<arch>
```

`bun build --compile` paketerar hela tRPC-grafen + git-peer-runtimen till en
fristående binär per server-plattform (darwin/linux). Binären behöver bara
system-`git` + git-creds vid körning.

## Kod

| Modul | Ansvar |
|-------|--------|
| `src/lib/server/local-first/server-runtime-config.ts` | env → validerad `RuntimeConfig` (zod) |
| `src/lib/server/local-first/peer-loop.ts` | `PeerLoop` — periodisk drivare (sync/cykel) |
| `src/lib/server/local-first/server-runtime.ts` | `startServerRuntime` — clone-if-absent + start |
| `src/bin/server-runtime.ts` | körbar entry (argv + signaler) |
| `tooling/scripts/build-server-runtime.ts` | cross-compile till binärer |

Deploy/drift (service-registrering, webhook-skydd, secrets-vault) ligger i
#81 / #79 — utanför #118:s scope.
