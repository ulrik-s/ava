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
                    │    └─ /         ─► releases/current   │
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
docker run --rm -v "$PWD:/app" -w /app -e DEMO_BASE_PATH= -e AVA_BUILD_TARGET=server oven/bun:1 sh -c \
  'bun install --frozen-lockfile && bun run server-first:build && bash tooling/scripts/build-demo.sh'
```

Det ger server-binären (`dist/`) och appen (`out/`). `bun run build:demo` bygger
under `/ava` (GH Pages) — Caddy serverar appen på roten, så base-pathen måste
vara tom.

`AVA_BUILD_TARGET=server` (#1352) bygger skalet **utan demodata**: ingen
`demo-seed.json`, inga `.ava/`-användare, inget datamanifest, inga demo-PDF:er
och inga förrenderade demo-ärenden (bara `__shell__`-sidorna). Skalet laddas
utan inloggning (#1245), så allt i `out/` är publikt på byråns domän — utan
flaggan låg demons fiktiva byrå öppet där. Bygget fälls om något ändå följt med
(`check-no-demo-data.ts`), och Caddy svarar 404 på samma sökvägar
(`demo-seed.json`, `.ava/*`, `documents/content/*`, `*.json` utom PWA-manifestet och `_next/*`) ifall
en äldre release med demodata blir aktiv igen, t.ex. efter `--rollback`.

Caddy serverar inte `out/` direkt utan `releases/current`, en symlänk till en
release (se *Uppgradering*). Gör den första releasen av bygget:

```bash
mkdir -p releases && mv out releases/initial && ln -s initial releases/current
```

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
`change_log`-rader. En användare som bara finns i tabellen (rå-SQL) syns inte
för klienten, som då visar "Inte behörig: ditt konto finns inte i byrån —
kontakta administratören" (#1391; förut hängde den på "Laddar…").

## Identitet: hur servern vet vem som anropar (#1256)

Caddy och oauth2-proxy gör inloggningen. Servern kan få veta vem användaren är
på två sätt, valt med `AVA_IDENTITY` i `ava-server.env`:

| Läge | Servern litar på | Säkert så länge |
|---|---|---|
| `forwarded` (default) | `X-Auth-Request-Email` som Caddy sätter | servern inte kan nås förbi Caddy |
| `verified` | en signerad token den själv verifierar mot IdP:ns nycklar | alltid (en förfalskad header ger ingenting) |

I `forwarded` bärs säkerheten av konfigurationen: bara Caddy publicerar portar,
och Caddy skriver över headern med det verifierade värdet.
`test/unit/tooling/identity-boundary.test.ts` fäller en ändring som bryter det.

**Slå på `verified`** (rekommenderat när inloggningen fungerar):

```
AVA_IDENTITY=verified
# AVA_IDENTITY_ISSUER = OIDC_ISSUER_URL och AVA_IDENTITY_AUDIENCE =
# OAUTH2_PROXY_CLIENT_ID sätts automatiskt; ange bara om de skiljer sig.
```

- oauth2-proxy lägger sin ID-token i auth-svaret
  (`OAUTH2_PROXY_SET_AUTHORIZATION_HEADER`), och Caddy skickar den till servern
  som `X-Ava-Identity-Token`. Servern hämtar IdP:ns nycklar via OIDC-discovery.
- Token:en måste bära `email`, eller en e-postadress i `preferred_username`
  (Entras UPN).
- ID-token gäller ofta bara en timme. Stacken förnyar den själv (#1351):
  `OAUTH2_PROXY_COOKIE_REFRESH=30m`, `OAUTH2_PROXY_COOKIE_EXPIRE=168h` och
  scope `openid email profile offline_access` är default i
  `docker-compose.production.yml` (åsidosätt med samma namn, resp. `OIDC_SCOPE`,
  i `ava-server.env`). Entra-appen måste få ge refresh-token: **API
  permissions → Microsoft Graph → delegated `offline_access`** (+ `openid`,
  `email`, `profile`) och **Grant admin consent** — annars kan användarna mötas
  av en godkännandedialog, eller "Need admin approval" om användarmedgivande är
  avstängt i tenanten. Google (provider `oidc`) godtar inte `offline_access`:
  sätt `OIDC_SCOPE=openid email profile`. Se
  [auth.md](auth.md#sessionen-i-klienten-och-idp-avbrott-1245-1351-adr-0018).
- Felkonfiguration (verified utan issuer eller audience) stoppar serverns start.

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
backuperna inte att läsa.** Därför, samma dag som nyckeln skapas (#1254):

1. Lägg in hela `age.key` (tre rader) som en säker anteckning i byråns
   lösenordshanterare. Den får inte bara ligga på datorn som hämtar.
2. **Bevisa att kopian fungerar:** klistra ut den ur lösenordshanteraren till
   en temporär fil och provåterställ med den (se *Provåterställning* nedan):
   `bash tooling/scripts/backup-verify.sh ~/AVA-backup/<senaste>.tar.age /tmp/kopia.key`,
   och radera sedan filen. En kopia som aldrig prövats är lika osäker som en
   backup som aldrig återställts.
3. Minst två personer på byrån ska kunna nå posten i lösenordshanteraren.

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
`content`-volymen). Steg för steg när servern är borta:
[`runbook-aterstallning.md`](./runbook-aterstallning.md).

#### Andra backupplatsen

En enda dator på kontoret är fortfarande en enda plats: brand, stöld och
ransomware på den datorn tar alla kopior. `backup-pull.sh` kopierar därför de
verifierade exporterna till en **andra plats**, `AVA_BACKUP_MIRROR`: en extern
disk, en NAS eller en molnsynkad mapp, helst på en annan adress.

**Den krävs (#1360).** Utan `AVA_BACKUP_MIRROR` gör hämtaren sitt jobb
(hämtar, verifierar, gallrar, kontrollerar åldern) men avslutar sedan med
larm (exit 1 + macOS-notis): *ingen andra backupplats*. Det enda
uttryckliga undantaget är `AVA_BACKUP_MIRROR=none`, som bara ska användas när
en andra hämtare på en annan plats redan finns (se nedan).

```bash
AVA_BACKUP_HOST=avabackup@ava.byra.se AVA_BACKUP_KEY=~/.config/ava-backup/age.key \
AVA_BACKUP_MIRROR=/Volumes/AVA-NAS/backup \
  bash tooling/scripts/backup-pull.sh ~/AVA-backup
```

- **Välj en svensk eller EU-baserad mottagare.** Byråns egen NAS på en annan
  adress (en delägares hem, ett andra kontor), eller en molnmapp hos en
  leverantör med datacenter i Sverige eller EU/EES och personuppgiftsbiträdes-
  avtal. Kopiorna är krypterade, men var de ligger ska ändå kunna redovisas
  för klienterna och IMY.
- Katalogen måste **finnas**. En omonterad volym larmar i stället för att
  tyst bli en lokal katalog på samma disk.
- Kopiorna kontrolleras mot sina checksummor vid varje körning, så en
  sönderskriven spegel upptäcks. Gamla kopior gallras efter
  `AVA_BACKUP_KEEP_DAYS`, som lokalt.
- Kopiorna är krypterade. En molnleverantör ser bara chiffer, men nyckeln får
  **aldrig** ligga i samma molnmapp.

Alternativet är en andra hämtare på en annan plats: samma `backup-pull.sh` på
en annan dator, med egen ssh-nyckel i `authorized_keys`. Servern påverkas inte
av hur många som hämtar.

#### Ta backup nu (från Inställningar, #1431)

En administratör kan ta en backup när som helst och få den direkt till datorn
hon sitter vid: **Inställningar → Backup → "Ta backup nu"**. Det är samma
backup som nattjobbet (`ava-backup.service`: `backup-db.sh` + `backup-export.sh`),
samma krypterade `ava-<datum>.tar.age` i `/srv/backup-chroot/ava`, och när den
är klar laddar webbläsaren ner den (med sha256-summan visad bredvid). Panelen
syns bara för administratörer och bara när servern har backup på begäran.

```
browser  "Ta backup nu" ─► backup.request (admin, max en per 10 min)
server   skriver /data/backup-requests/request.json   (= /srv/ava/backup-requests)
host     ava-backup-request.path ─► ava-backup-request.service ─► ava-backup.service
server   ser en ny export i /data/backup-exports (read-only) ─► läget "klar"
browser  GET /api/backup/download?name=… ─► filen strömmas till datorn
```

- **Filen är krypterad.** Servern har bara den publika age-nyckeln; filen går
  bara att öppna med den privata (`age.key` i lösenordshanteraren). Återställ
  enligt [`runbook-aterstallning.md`](./runbook-aterstallning.md).
- **Containern får ingen host-åtkomst.** Den kan bara ändra en fil i
  `/srv/ava/backup-requests`; vad som körs står i enhetsfilerna
  ([`tooling/systemd/`](../tooling/systemd/)), filens innehåll läses aldrig av
  hosten. `ava-backup-request.service` kör ingenting om en export skrevs de
  senaste fem minuterna — en kapad container kan inte köra backupjobbet i en
  loop och fylla disken.
- **Granskning:** varje begäran (`backup.requested`) och nedladdning
  (`backup.downloaded`) loggas med användarens id — `docker compose … logs server-first`.
- Nedladdningen går under `/api`, så Caddy kräver en inloggad session innan
  servern ser anropet, och servern kräver sedan en administratör.
- Blev en begärd backup inte klar inom en timme visar panelen det: titta i
  `journalctl -u ava-backup -u ava-backup-request`.

**Engångssteg på hosten:** inget, om nattjobbet körs som `ava-backup.service`
— `deploy-prod.sh` installerar och uppdaterar `.path`-enheten själv (bara när
filerna ändrats) och compose monterar katalogerna. Saknas `ava-backup.service`
(cron i stället) säger deployen det, och knappen ger då "inte klar inom en
timme" tills nattjobbet läggs som en systemd-tjänst. För hand:

```bash
install -m 644 tooling/systemd/ava-backup-request.* /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now ava-backup-request.path
```

Ligger exporterna någon annanstans än `/srv/backup-chroot/ava`, sätt
`AVA_BACKUP_EXPORT_HOST_DIR` i `ava-server.env` (och rätta sökvägen i
`ava-backup-request.service`).

#### Provåterställning (varje vecka)

Hämtningen provdekrypterar varje natt. Det bevisar att filen går att *öppna*.
`backup-verify.sh` bevisar att den går att **återställa**: den dekrypterar,
läser in dumpen i en *engångs-Postgres* (docker) och kontrollerar att
användarna och migrationerna finns och att **varje dokument databasen pekar på
finns i dokumentarkivet**. Produktionen berörs inte.

```bash
bash tooling/scripts/backup-verify.sh ~/AVA-backup/ava-2026-09-29-0300.tar.age ~/.config/ava-backup/age.key
```

Lägg den i launchd eller cron varje söndag, på den senaste backupen. Samma
kedja (export → dekryptering → återställning → kontroll) körs i CI av
återställningsövningen nedan, mot en export med ett riktigt uppladdat dokument.

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

Övningen går dessutom igenom **offsite-kedjan**: en krypterad export
(`backup-export.sh`) med ett riktigt uppladdat dokument provåterställs med
`backup-verify.sh` i en engångs-Postgres. Det är samma väg som används när
servern är borta ([`runbook-aterstallning.md`](./runbook-aterstallning.md)).

Steget "bekräfta att den är borta" är det som gör övningen ärlig — utan det
skulle en återställning som inte gör någonting alls se ut att lyckas.

## Uppgradering

```bash
cd /srv/ava && bash tooling/scripts/deploy-prod.sh             # deploy
cd /srv/ava && bash tooling/scripts/deploy-prod.sh --dry-run   # visa stegen, ändra inget
```

Skriptet gör hela rundan: `origin/main` (fast-forward) → backup → **tömmer
`.next/cache`** → bygger i `oven/bun` till `out/` → kontrollerar att den byggda
CSS:en har varje regel ur `globals.css` → lägger bygget i
`releases/<tid>-<sha>` → kör migrationerna → startar om servern och väntar på
`/readyz` → **först då** byts klienten (`releases/current`) → städar gamla
releaser.

Byggcachen töms med flit varje gång (#1166): en gång gav den gammal CSS i prod
— nya regler saknades trots rätt källkod och nya JS-chunkar, och inget larmade.

### Releaser: varför klienten inte byggs där Caddy läser (#1369)

```
releases/
  20261001T130000Z-16e81735/   den aktiva klienten
  20260930T090000Z-8dc303d5/   förra (behålls för rollback)
  current  -> 20261001T130000Z-16e81735
  previous -> 20260930T090000Z-8dc303d5
```

Caddy monterar hela `releases/` och har `root /srv/releases/current`. Länken
följs vid varje request, så klientbytet är ett enda `rename` av länken —
atomärt, utan omstart. Förr byggdes klienten rakt in i `out/`, som Caddy
monterade: `next build` ersätter `out/` med en ny katalog (en mount pekar på
den gamla), så prod gav 404 under bygget, och när CSS-kontrollen sedan föll låg
den nya klienten ändå ute mot den gamla servern. Nu är `out/` bara byggets
arbetskatalog.

Ordningen är medveten: servern startas om och måste svara på `/readyz` innan
klienten byts. En ny server tar emot gamla klienter (öppna flikar och
offline-cachen gör det ändå); en ny klient mot en gammal server är det som gick
sönder.

### Avbrott och omkörning

Varje steg går att köra om, så efter ett avbrott: rätta felet och kör samma
kommando igen. Migrationerna körs **alltid** — `db-migrate` hoppar själv över
filer som redan står i `schema_migrations`. (Förr kördes de bara om `git diff`
mot förra versionen visade nya filer, och vid en omkörning var koden redan
uppdaterad → tom lista → migrationerna hoppades över.) Ändras deploy-skriptet
självt i `origin/main` startar det om sig i den nya versionen.

Avbryts skriptet skriver det ut läget, t.ex.:

```
!! deploy AVBRÖTS i steget: kontrollerar byggd CSS mot globals.css (exit 1)
   kod (git): uppdaterad 8dc303d5 → 16e81735 (påverkar inget som körs förrän servern startas om)
   klient:    oförändrad — releases/current -> 20260930T090000Z-8dc303d5 (previous -> …)
   server:    oförändrad
   databas:   oförändrad
```

### Rollback

**Klienten** (en UI-regression — det vanliga fallet) byts tillbaka på en
sekund, utan omstart:

```bash
bash tooling/scripts/deploy-prod.sh --rollback   # current ↔ previous; kör igen för att ångra
```

**Servern** går också att backa, men **migrationer går bara framåt**: backa bara
till en version vars kod klarar det nuvarande schemat (migrationer som bara
lägger till är ofarliga). Annars: återställ databasen från backupen som
deployen tog (se *Återställning*).

```bash
git checkout --detach <sha>                      # sha:n står i releasens namn
docker run --rm -v "$PWD:/app" -w /app oven/bun:1 sh -c \
  'bun install --frozen-lockfile >/dev/null && bun run server-first:build'
docker compose -f tooling/docker/docker-compose.production.yml up -d --build server-first
git checkout main                                # nästa deploy-prod.sh tar det härifrån
```

### Första deployen med releases/ (en gång, #1369)

Den här ändringen flyttar Caddys mount från `out/` till `releases/`. Kör
**inte** den gamla versionen av skriptet för den — den läser vidare i sin egen,
gamla fil och skulle starta Caddy mot en tom `releases/`. Hämta koden först, så
att det nya skriptet kör:

```bash
cd /srv/ava
git fetch origin && git merge --ff-only origin/main
bash tooling/scripts/deploy-prod.sh
```

Skriptet ser att `releases/current` saknas, kopierar den nuvarande `out/` till
en release, pekar `current` på den och skapar om Caddy med den nya mounten
(ett par sekunders avbrott) — innan bygget rör `out/`. Resten är en vanlig
deploy. Hände det ändå (Caddy ger 404 överallt): kör det nya skriptet, så görs
samma sak med den `out/` som finns.

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

### Fulltextindexet (engångs-backfill, #1215)

Dokumentsökningen läser sidtexten i `document_pages`. Nya och ändrade dokument
indexeras av dokumentjobbet; dokument som laddades upp innan indexet fanns
fylls på EN gång, efter att migration 0026 körts och `server-first` startats
om (workern på kön måste finnas):

```bash
avarun tooling/scripts/backfill-search-index.ts
```

Skriptet köar ett `index-document`-jobb per dokument — servern läser bytes ur
content-store:n och skriver sidorna. Inget klassificeras om, och en omkörning
är ofarlig (sidorna ersätts). Följ förloppet med
`docker compose -f tooling/docker/docker-compose.production.yml logs -f server-first`.

### Dokumentdelar (omklassificering, #1220)

Sammansatta dokument ("kallelse + stämning + FUP" i en PDF) får delar när
klassificeringsjobbet körs. Nya uppladdningar får dem direkt. Befintliga
dokument får dem efter migration 0027 och omstart av `server-first` med:

```bash
avarun tooling/scripts/backfill-search-index.ts --reclassify
```

Skriptet köar ett `classify-document`-jobb per dokument (indexering +
klassificering + segmentering). Användarens val skrivs inte över:
specialvärden i dokumenttypen (Kostnadsräkning, E-post, fritext) rörs inte och
får inga delar; en dokumenttyp som användaren satt (en kategorikod som servern
aldrig analyserat och som inte är filnamnsgissningen) behålls och blir EN
manuell del; delar som rättats i dokumentpanelen (MANUAL) bevaras så länge
sidantalet är detsamma. LLM-anropen är högst 12 per dokument (~11 s styck med
qwen2.5:1.5b) — räkna med att kön tar en stund för stora arkiv.

### Standardmappar i befintliga ärenden (engångs-backfill, #1228)

Nya ärenden får dokumentmapparna direkt när de skapas (`DEFAULT_MATTER_FOLDERS`
i `src/lib/shared/default-matter-folders.ts`):

```
Faktura
Domstol
  Kallelse
  Föreläggande
  Förordnande
  Inlagor
Beslut
Korrespondens
Avtal
Övrigt
```

Ärenden som fanns innan dess får de mappar som saknas med:

```bash
avarun tooling/scripts/backfill-matter-folders.ts
```

Skriptet går igenom alla ärenden som inte är raderade och skapar bara de mappar
som saknas. En mapp med samma namn (oavsett versaler/gemener) i samma
föräldramapp räknas som redan skapad, så undermapparna läggs också till under
en "Domstol" som redan finns. Att köra skriptet igen skapar inga fler mappar.
Mapparna skrivs via repona med change_log, så klienterna får dem vid nästa
synk. Ingen migration eller omstart behövs.

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

## Felrapportering till PostHog EU (valfritt)

Ingen felrapportering är påslagen som standard. Med en PostHog-nyckel skickas
serverns oväntade fel (5xx, aldrig 4xx) till PostHog **EU Cloud (Frankfurt)** —
standardvärden är `eu.i.posthog.com` och en amerikansk värd vägras. Teckna
PostHogs biträdesavtal (DPA) innan nyckeln sätts. Vad som skickas: se
`docs/observability.md`. I `ava-server.env`:

```bash
AVA_POSTHOG_KEY=phc_<byråns-projekt-token>   # skapas på eu.posthog.com
# AVA_POSTHOG_HOST=https://posthog.byran.se   # bara vid själv-hostad PostHog
# AVA_ERROR_ENVIRONMENT=staging               # default production
# AVA_RELEASE=<commit-sha>                    # server-versionen
```

```bash
docker compose -f tooling/docker/docker-compose.production.yml up -d server-first
docker compose -f tooling/docker/docker-compose.production.yml logs server-first | grep felrapportering
```

Exakt vad som skickas (felklass, felkod, procedur, requestId, version, miljö,
tid och `fil:rad`-ramar — aldrig meddelanden, användare eller indata) står i
[observability.md](observability.md#felrapportering-till-posthog-eu-1343).

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
