# Server-runtime — drift & auth (#81, ADR 0005)

Server-runtime:n är en **git-peer**: den klonar `firma.git`, kör mutationer mot
sin egen working-copy och pushar tillbaka (konflikt-säkert, ADR 0002/0005). Den
är **valbar** — bara byråer som vill ha server-drivna integrationer (Fortnox
#82, påminnelser) kör den. En ensam jurist utan integrationer kör helt utan
server, precis som förut (USP: din data, ingen tredjepartsinfra).

## Paketering

En tunn docker-image (`debian-slim` + `git` + den förbyggda standalone-binären):

```bash
bun run server-runtime:build        # → dist/server-runtime/ava-server-runtime-linux-{x64,arm64}
docker build -f tooling/docker/server-runtime/Dockerfile -t ava-server-runtime .
```

Binären byggs utanför imagen (samma artefakt som release-pipelinen #87
publicerar) så vi slipper en tung monorepo-`bun install` i docker. Entrypoint:en
väljer rätt arkitektur via `uname -m`.

## Köra i stacken

Tjänsten ligger i `tooling/docker/docker-compose.yml` bakom profilen `server`
(default av):

```bash
AVA_SR_ORG_ID=<org-id> \
AVA_SR_GIT_USER=<htpasswd-användare> AVA_SR_GIT_TOKEN=<PAT> \
  docker compose -f tooling/docker/docker-compose.yml --profile server up -d --build
```

## Auth mot firma.git

Git-creds tas vid körning (aldrig inbakade i imagen). Två vägar:

| Metod | Env | Användning |
|-------|-----|------------|
| **HTTP-basic** | `AVA_SR_GIT_USER` + `AVA_SR_GIT_TOKEN` | htpasswd-användare/PAT mot nginx `/git/` (samma som browser-push). Default-URL `http://web/git/firma.git` i det interna nätet. |
| **SSH-deploy-key** | `AVA_SR_SSH_KEY_FILE` (monterad privat nyckel) | `ssh://`-remotes (lägg publika nyckeln i `git-ssh/authorized_keys`). |

Entrypoint:en skriver en 600-skyddad `~/.git-credentials` (HTTP) resp. sätter
`GIT_SSH_COMMAND` (SSH). `file://`-repos (lokal drift/röktest) behöver ingen auth.

## Konfiguration (env)

Obligatoriskt: `AVA_SR_REPO_URL`, `AVA_SR_WORK_DIR` (satt i imagen), `AVA_SR_ORG_ID`.
Övrigt (`AVA_SR_BRANCH`, `AVA_SR_REMOTE`, `AVA_SR_POLL_INTERVAL_MS`,
`AVA_SR_MAX_RETRIES`, `AVA_SR_PRINCIPAL_*`) har defaults — se
`src/lib/server/local-first/server-runtime-config.ts` (`ENV_KEYS`).

### Fortnox-connector (#82)

Connectorn aktiveras när secrets-valvet (#79) är tillgängligt: sätt
`AVA_SECRETS_KEY` + `AVA_SECRETS_FILE` och montera valv-filen i containern
(se den utkommenterade volym-raden i compose). Saknas valv/tokens kör loopen i
sync-läge (ingen bokföring) — riskfritt.

## Röktest

```bash
bun run server-runtime:smoke
```

Bygger binär + image och kör containern `--once` mot ett lokalt bare-repo;
verifierar att den klonar, tickar och avslutar 0. Kräver docker + bun + git.

## Webhooks

Skyddad webhook-endpoint (HTTPS + signaturverifiering) hör till v1.1 (#219) —
server-runtime:n är poll-baserad idag och har ingen webhook-konsument.
