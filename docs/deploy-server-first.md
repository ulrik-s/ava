# Deploy: self-hosted AVA (server-first)

Hur en byrå går från demo till egen drift. Fyra containers, fyra volymer,
automatiskt TLS.

> **Ersätter [`deploy-tier3-self-hosted.md`](./deploy-tier3-self-hosted.md)**,
> som beskriver den git-baserade arkitekturen. Den pensionerades av
> [ADR 0016](./adr/0016-server-first-med-offline-first-klient.md) — Postgres är
> den auktoritativa lagringen sedan cutovern. Följer du den gamla doc:en får du
> fel system **och** en backup som säkerhetskopierar fel data.

## Arkitektur

```
                    ┌──────────── Linux-server ─────────────┐
  Browser ──443──►  │  caddy      TLS + statisk app + proxy  │
                    │    │                                   │
                    │    ├─ /oauth2/* ─► oauth2-proxy ──OIDC──┼──► byråns IdP
                    │    ├─ /api/*    ─► server-first        │    (Entra/Google)
                    │    └─ /         ─► out/ (statisk app)  │
                    │                       │                │
                    │                  postgres  ◄── akterna │
                    │                                        │
                    │  autoheal  ── startar om det som hänger│
                    └────────────────────────────────────────┘
```

Ingen inbyggd IdP: `oauth2-proxy` gör OIDC-discovery mot byråns egen. Har
byrån Microsoft 365 loggar advokaterna in med sina vanliga konton — se
[`self-hosted-entra.md`](./self-hosted-entra.md).

## Förutsättningar

- Linux-server med docker + docker compose (2 GB RAM räcker gott)
- Ett DNS-namn som pekar på servern (Caddy hämtar certet automatiskt — port
  80 måste vara öppen för ACME-utmaningen)
- En OIDC-app hos byråns IdP: client-id, client-secret, redirect-URI
  `https://<domän>/oauth2/callback`

### Var servern bör stå

Byråns akter omfattas av advokatsekretess. Välj leverantör därefter — svensk
eller åtminstone EU-baserad — och dokumentera valet; det är en fråga byrån
kommer att få från sina klienter, inte en teknikdetalj.

## Installation

```bash
git clone https://github.com/ulrik-s/ava && cd ava
bun install
bun run server-first:build      # server-binären
bun run build:demo              # den statiska appen → out/
```

Skapa `ava-server.env`:

```bash
AVA_DOMAIN=ava.byra.se
AVA_ORGANIZATION_ID=<uuid>            # bun -e 'console.log(crypto.randomUUID())'
POSTGRES_PASSWORD=<slumpat>           # openssl rand -base64 32
OIDC_ISSUER_URL=https://login.microsoftonline.com/<tenant>/v2.0
OAUTH2_PROXY_CLIENT_ID=<app-id>
OAUTH2_PROXY_CLIENT_SECRET=<hemlighet>
OAUTH2_PROXY_COOKIE_SECRET=<32 byte>  # openssl rand -base64 32 | head -c 32
OIDC_EMAIL_DOMAINS=byra.se            # vilka som får logga in
```

Starta:

```bash
set -a && . ava-server.env && set +a
docker compose -f tooling/docker/docker-compose.production.yml up -d --build
AVA_DATABASE_URL="postgres://ava:$POSTGRES_PASSWORD@localhost:5432/ava" bun run db:migrate
```

## Övervakning

### Två hälsokontroller, och skillnaden spelar roll

| Rutt | Frågar | Vid fel |
|---|---|---|
| `/healthz` | svarar processen? | processen hänger → **starta om** |
| `/readyz` | kan den göra sitt jobb (databasen svarar)? | orsaken kan ligga utanför processen → **starta inte om blint** |

Startar man om en app vars databas är nere får man en omstartsloop som döljer
den verkliga orsaken. Därför skiljer stacken på dem.

`/readyz` rör faktiskt databasen med en tidsbegränsad fråga. Den gamla
`/healthz` i nginx svarade en statisk rad och rapporterade frisk även när
tjänsten var död — en hälsokontroll som inte kan gå sönder är värdelös.

### Omstart vid hängning

`restart: unless-stopped` täcker bara **krascher**. En process som lever men
slutat svara startas aldrig om av docker — den är ju igång.

Därför kör stacken `autoheal`, som bevakar healthcheck-statusen och startar om
det som står som `unhealthy`. Kedjan är: `/readyz` säger sanningen →
healthchecken märker → autoheal agerar. Går första ledet sönder gör inget av
de andra någon nytta.

Kontrollera status:

```bash
docker compose -f tooling/docker/docker-compose.production.yml ps
curl -s https://ava.byra.se/readyz     # {"status":"ok","checks":{"database":{"ok":true}}}
```

### Vad som INTE finns

Ingen strukturerad loggning, ingen felrapportering (Sentry e.d.), ingen
produktanalys. Loggarna är containerloggar:

```bash
docker compose -f tooling/docker/docker-compose.production.yml logs -f server-first
```

För en pilot räcker det. Innan fler byråer kör skarpt bör åtminstone
felrapportering finnas — annars får du reda på fel genom att någon ringer.

## Backup

Akterna ligger i Postgres. **Utan verifierad återställning är systemet inte
driftsatt-bart för en advokatbyrå.**

```bash
bash tooling/scripts/backup-db.sh /srv/ava/backup
```

Skriver `ava-<datum>.sql.gz` + checksumma, och vägrar skriva en dump som är
trasig eller misstänkt liten — en tyst halv backup är värre än ingen, för den
ser ut att finnas ända tills man behöver den.

Lägg den i cron, och **kopiera den av servern**. En backup som ligger på
samma maskin som databasen skyddar mot råttfel, inte mot att servern brinner:

```cron
0 3 * * * cd /srv/ava && bash tooling/scripts/backup-db.sh /srv/ava/backup
```

### Återställning

```bash
bash tooling/scripts/restore-db.sh /srv/ava/backup/ava-2026-09-05-0300.sql.gz
```

Stoppar server-first före, lägger tillbaka dumpen, startar och väntar tills
`/readyz` svarar ok. Skriver applikationen under tiden blir resultatet en
blandning av två tidpunkter — värre än båda var för sig.

### Övningen

En backup som aldrig återställts är en förhoppning. `restore-drill.sh` kör
hela vägen — skapar ett ärende via API:t, tar backup, **förstör datan**,
bekräftar att den är borta, återställer och bekräftar att den är tillbaka.

Den körs i CI vid varje ändring av backup-skripten eller compose:n, så rutinen
inte hinner ruttna. Kör den också mot din egen server första gången:

```bash
bash tooling/scripts/restore-drill.sh
```

Steget "bekräfta att den är borta" är det som gör övningen ärlig — utan det
skulle en återställning som inte gör någonting alls se ut att lyckas.

## Uppgradering

```bash
git pull && bun install
bun run server-first:build && bun run build:demo
docker compose -f tooling/docker/docker-compose.production.yml up -d --build
AVA_DATABASE_URL=… bun run db:migrate
```

**Ta backup före migrering.** Migrationer går framåt, inte bakåt.
