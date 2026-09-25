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

- Linux-server med docker + docker compose + git (2 GB RAM räcker gott) — inget annat på hosten
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
# Bygg i en container — hosten behöver bara docker + git, ingen bun/node.
docker run --rm -v "$PWD:/app" -w /app -e DEMO_BASE_PATH= oven/bun:1 sh -c \
  'bun install --frozen-lockfile && bun run server-first:build && bash tooling/scripts/build-demo.sh'
```

Det ger server-binären (`dist/`) och appen (`out/`). `bun run build:demo` bygger
under `/ava` (GH Pages) — Caddy serverar `out/` på roten, så base-pathen måste
vara tom.

Skapa `ava-server.env`:

```bash
AVA_DOMAIN=ava.byra.se
# = klientens default-org (firma-config.ts). En byrå per server → ingen
# anledning att välja ett eget; ett annat id kräver att varje browser sätter
# samma org i /settings.
AVA_ORGANIZATION_ID=00000000-0000-0000-0000-000000000001
POSTGRES_PASSWORD=<slumpat>           # openssl rand -hex 24  (hex: hamnar i en URL)
OIDC_ISSUER_URL=https://login.microsoftonline.com/<tenant>/v2.0
OAUTH2_PROXY_CLIENT_ID=<app-id>
OAUTH2_PROXY_CLIENT_SECRET=<hemlighet>
OAUTH2_PROXY_COOKIE_SECRET=<32 byte>  # openssl rand -hex 16
OIDC_EMAIL_DOMAINS=byra.se            # vilka som får logga in
AVA_EMAIL_DISABLED=1                  # test/pilot: inga mejl ut, inte ens om SMTP sätts
```

`AVA_EMAIL_DISABLED=1` stänger av e-postutskick helt: e-postporten vägrar med ett
tydligt fel i st.f. att köa, och ingen utskicks-handler registreras ens om
`AVA_SMTP_*` är satt. Utan flaggan köas mejl på pg-boss — de ligger kvar och går
iväg den dag SMTP konfigureras, så en testserver ska ha flaggan från start.

Starta, migrera och skapa byrån + första admin. Postgres har ingen host-port,
så skripten körs i en engångs-container på compose-nätet:

```bash
set -a && . ./ava-server.env && set +a
docker compose -f tooling/docker/docker-compose.production.yml up -d --build
avarun() { docker run --rm --network ava_default -v "$PWD:/app" -w /app \
  -e AVA_DATABASE_URL="postgres://ava:$POSTGRES_PASSWORD@postgres:5432/ava" \
  -e AVA_ORGANIZATION_ID -e AVA_ORG_NAME -e AVA_ADMIN_EMAIL -e AVA_ADMIN_NAME \
  oven/bun:1 bun "$@"; }
avarun tooling/scripts/db-migrate.ts
AVA_ORG_NAME="Byrån AB" AVA_ADMIN_EMAIL=anna@byra.se AVA_ADMIN_NAME="Anna" \
  avarun tooling/scripts/seed-selfhosted-local.ts
```

Det finns ingen JIT-provisionering: bara emailadresser i byråns användarlista
släpps in, även om IdP:n godkänner inloggningen. Admin lägger till fler
användare i appen (`/users`). Seeden går via repo-lagret så användarna får
`change_log`-rader — rå-SQL hade gett en klient som hänger på "Laddar…".

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

### Backup utanför servern (pull, krypterat)

En backup på samma maskin skyddar inte mot att servern försvinner eller
kapas. Därför **hämtar** en dator på byrån backupen varje natt — servern har
ingen väg in till den datorn och kan inte radera kopiorna där.

```
server 03:00  backup-export.sh ── db-dump + content-volymen → tar → age (publik nyckel)
                                   → /srv/backup-chroot/ava/  (read-only SFTP, chroot)
byrå   04:00  backup-pull.sh  ◄── hämtar nya, verifierar checksumma, provdekrypterar,
                                   sparar 90 dagar, larmar om senaste > 48 h
```

**Nyckeln:** age-nyckelparet skapas på datorn som hämtar
(`age-keygen -o ~/.config/ava-backup/age.key`); bara den *publika* nyckeln
ligger på servern (`/srv/ava/backup-recipient.txt`). Kapas servern kommer
angriparen inte åt backuperna. **Förlorar ni den privata nyckeln går
backuperna inte att läsa** — lägg en kopia i byråns lösenordshanterare.

**Servern:** en systemanvändare utan skal som bara når exportkatalogen
read-only:

```bash
useradd --system --no-create-home --home-dir / --shell /usr/sbin/nologin avabackup
install -d -o root -g root -m 755 /srv/backup-chroot
install -d -o root -g avabackup -m 2750 /srv/backup-chroot/ava
echo "restrict <hämtarens ssh-publika nyckel>" > /etc/ssh/authorized_keys/avabackup
cat > /etc/ssh/sshd_config.d/ava-backup.conf <<'EOF'
Match User avabackup
    AuthorizedKeysFile /etc/ssh/authorized_keys/avabackup
    PasswordAuthentication no
    ChrootDirectory /srv/backup-chroot
    ForceCommand internal-sftp -R -d /ava
    AllowTcpForwarding no
    AllowAgentForwarding no
    X11Forwarding no
    PermitTTY no
EOF
sshd -t && systemctl reload ssh
```

Lägg `backup-export.sh` efter `backup-db.sh` i nattjobbet (systemd-timer eller
cron). **Hämtaren** (macOS: launchd, Linux/NAS: cron):

```bash
AVA_BACKUP_HOST=avabackup@ava.byra.se AVA_BACKUP_KEY=~/.config/ava-backup/age.key \
  bash tooling/scripts/backup-pull.sh ~/AVA-backup
```

Återställ från en hämtad kopia: `age -d -i age.key ava-<datum>.tar.age | tar -x`
ger `ava-<datum>.sql.gz` (→ `restore-db.sh`) och `content.tar.gz` (packas upp i
`content`-volymen).

### Återställning

```bash
bash tooling/scripts/restore-db.sh /srv/ava/backup/ava-2026-09-05-0300.sql.gz
```

Stoppar server-first, kopplar ner kvarvarande sessioner, **återskapar
databasen**, läser in dumpen, startar och väntar tills `/readyz` svarar ok.
Skriver applikationen under tiden blir resultatet en blandning av två
tidpunkter — värre än båda var för sig.

> Varför drop-and-create i stället för `pg_dump --clean`: pg-boss partitionerar
> sina jobbtabeller, och de DROP-satser `--clean` genererar fallerar på ärvda
> constraints (`cannot drop inherited constraint "job_common_pkey"`). Med
> `--clean` gick backupen **inte att återställa alls** — upptäckt av övningen
> nedan, vilket är hela poängen med att ha den.

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
cd /srv/ava && bash tooling/scripts/deploy-prod.sh
```

Skriptet gör hela rundan: backup → `origin/main` (fast-forward) → **tömmer
`.next/cache`** → bygger i `oven/bun` → kontrollerar att den byggda CSS:en har
varje regel ur `globals.css` (annars avbryts det innan något startas om) → kör
nya migrationer om deployen har några → startar om och väntar på `/readyz`.

Byggcachen töms med flit varje gång (#1166): en gång gav den gammal CSS i prod
— nya regler saknades trots rätt källkod och nya JS-chunkar, och inget larmade.

### Manuellt

**Ta backup före migrering.** Migrationer går framåt, inte bakåt.

```bash
bash tooling/scripts/backup-db.sh /srv/ava/backup
avarun tooling/scripts/db-migrate.ts        # kör bara filer som inte körts
```

`db-migrate` spårar körda filer i `schema_migrations` (#1107); varje fil körs i
en egen transaktion ihop med sin spår-rad, så en fil som fallerar lämnar inget
halvt schema efter sig.

> **Databas migrerad före #1107** (har schemat men ingen `schema_migrations`):
> migreringen vägrar, eftersom den inte kan veta vilka filer som körts. Kör
> `avarun tooling/scripts/db-migrate.ts --baseline` EN gång, INNAN du drar ner
> nya migrationer — det markerar alla filer i checkouten som körda.

## AVA Helper (valfritt)

Helpern (ADR 0028) öppnar dokument i Word/Excel på användarens dator och
synkar tillbaka. Den kör utanför browsern och har ingen session-cookie, så den
loggar in mot byråns IdP själv och skickar sin access-token som
`Authorization: Bearer`. Allt är **av** tills du slår på det i `ava-server.env`:

| Variabel | Värde (Entra) | Gör |
|---|---|---|
| `AVA_HELPER_ENABLED` | `true` | oauth2-proxy accepterar verifierade Bearer-token (signatur, issuer, `aud` = `OAUTH2_PROXY_CLIENT_ID`) och sätter `X-Auth-Request-Email` ur tokenets `email`-claim — samma principal som cookie-vägen |
| `AVA_HELPER_OIDC_ISSUER` | samma som `OIDC_ISSUER_URL` (`https://login.microsoftonline.com/<tenant>/v2.0`) | webbappen pushar helperns inloggnings-config (`system.helperConfig`) |
| `AVA_HELPER_OIDC_CLIENT_ID` | samma som `OAUTH2_PROXY_CLIENT_ID` | klient-id helpern loggar in med |
| `AVA_HELPER_OIDC_SCOPE` | `api://<klient-id>/access_as_user openid email profile offline_access` | scopet helpern ber om — utan byråns API-scope får token Graph som audience och avvisas |
| `AVA_HELPER_OIDC_JWKS_URI` | `https://login.microsoftonline.com/<tenant>/discovery/v2.0/keys` | Entras nycklar (default-vägen är Keycloaks) |
| `AVA_HELPER_OIDC_AUDIENCE` | tomt | lämna tomt — oauth2-proxy kontrollerar `aud` |

Entra-appen måste först exponera ett API och lägga `email` i access-token,
annars saknar helperns token det oauth2-proxy verifierar mot — se
[self-hosted-entra.md](self-hosted-entra.md#ava-helper).

```bash
docker compose -f tooling/docker/docker-compose.production.yml up -d oauth2-proxy server-first
```

## Dokumentklassificering med lokal LLM (valfritt)

Uppladdade dokument klassificeras (stämning, dom, fullmakt …) av ett jobb på
servern. Utan LLM tittar det bara på filnamnet. Med den lokala modellen läses
dokumentets text — ingen text lämnar servern.

I `ava-server.env`:

```bash
COMPOSE_PROFILES=llm
AVA_LLM_ENDPOINT=http://ollama:11434/v1
AVA_LLM_MODEL=qwen2.5:1.5b
```

```bash
docker compose -f tooling/docker/docker-compose.production.yml up -d ollama server-first
docker compose -f tooling/docker/docker-compose.production.yml logs -f ollama   # modellen laddas ner första gången (~1 GB)
```

Modellen är liten med flit: en server med 2 vCPU och ingen GPU klassificerar
ett dokument på ~11 s med `qwen2.5:1.5b` (6 av 7 rätt på testdokument), och
`qwen2.5:3b` tar dubbelt så lång tid för samma resultat. Ollama har ett
minnestak på 3 GB. Byt modell genom att ändra `AVA_LLM_MODEL` och starta om
`ollama` + `server-first` — nedladdningen sker automatiskt.
