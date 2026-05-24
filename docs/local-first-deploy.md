# AVA local-first — deploy-guide

Den här guiden beskriver de **operationella stegen** för att deploya AVA i
local-first-läget. Arkitekturen + koden är beskriven i
[`architecture-future.md`](./architecture-future.md). Den här filen handlar
om **bygga, paketera, installera och migrera**.

## Översikt

Tre saker behöver göras (i denna ordning):

1. **Bygga klient-appen** (Tauri-bundle av Next-appen)
2. **Sätta upp byrå-servern** (en SSH-låda med git)
3. **Migrera data** (Postgres → git, om byrån kommer från server-läget)

Användare sedan kör en bootstrap som klonar repo:t + initierar lokal SQLite.

## 1. Bygga Tauri-appen

### Förkrav

- **Rust toolchain** — installera via [rustup](https://rustup.rs/) (`curl ... | sh`)
- **Node 22+** med yarn (corepack)
- Plattforms-specifikt:
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Windows**: WebView2 (preinstalled på Win 11), Visual Studio Build Tools
  - **Linux**: `libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev`

### Bygg-kommandon

```bash
# Generera SQLite-schemat (en gång — committas inte)
yarn schema:sqlite

# Utveckling (öppnar Tauri-window + Next dev-server)
yarn tauri:dev

# Produktions-bundle för aktuell plattform
yarn tauri:build
# → src-tauri/target/release/bundle/<platform>/AVA-<version>.<dmg|msi|AppImage>
```

### Plattforms-spec utgång

| Plattform | Filtyp | Storlek |
|---|---|---|
| macOS | `.dmg`, `.app` | ~50 MB |
| Windows | `.msi` | ~40 MB |
| Linux | `.AppImage`, `.deb` | ~70 MB |

## 2. Byrå-servern

En enkel SSH-uppkopplad Linux-låda räcker. Inga applikations-daemons.

### Installera

```bash
sudo apt update
sudo apt install -y openssh-server git git-lfs rsync
sudo adduser --system --shell=/usr/bin/git-shell --home=/srv/git git
```

### Lägg upp första repo:t

```bash
sudo -u git mkdir -p /srv/git/firma-x.git
sudo -u git git -C /srv/git/firma-x.git init --bare --initial-branch=main
```

### Tillåt en användare

Lägg deras SSH-public-key i `/home/git/.ssh/authorized_keys` (eller låt
`.ava/users/<email>.json` driva det automatiskt via en `post-receive`-hook —
se `architecture-future.md` §3.8).

### Backup

```bash
# /etc/cron.daily/ava-backup
#!/bin/sh
rsync -a /srv/git/ backup-host:/backup/ava/$(date +%F)/
```

Notera att **varje klient är en backup också** — git har innebär N+1 backup
gratis. Servern behöver bara fixas vid corruption, inte vid komplett förlust.

## 3. Datamigration Postgres → git

För byråer som flyttar från server-läget:

```bash
# På den maskin som har Postgres-anslutning
DATABASE_URL="postgresql://..." \
yarn migrate:pg-to-git \
  --org cm09abc123 \
  --dir ~/ava-export/firma-x \
  --push ssh://git@your-server/srv/git/firma-x.git
```

Detta:

1. Klonar/initierar git-repo i `~/ava-export/firma-x`
2. Loopar alla matters/contacts/users för byrån via Prisma
3. Projicerar varje entitet till JSON-fil
4. Commitar med meddelande "Initial import från Postgres (N entiteter)"
5. Pushar till byrå-servern (om `--push` ges)

Per `exporter.entities`-räknare:
- `matter`: aktiva → `matters/active/`, arkiverade → `matters/archive/<år>/`
- `contact`: `contacts/<id>.json`
- `user`: `.ava/users/<email>.json`

Övriga entiteter (document, invoice, time-entry, expense osv.) projiceras
**inte** ännu — de behöver projection-impl + ENTITY_FETCHER-mapping.
Se TODO-listan i `docs/architecture-future.md` §7.4 step 8.

## 4. Användar-bootstrap

När en användare installerat klient-appen kör hen:

```bash
bash tooling/scripts/bootstrap-local-first.sh \
  --repo ssh://git@your-server/srv/git/firma-x.git \
  --dir "$HOME/Library/Application Support/AVA/firma-x" \
  --user anna@firma.se
```

Vilket:

1. Klonar repo:t (partial clone — bara refs, inga blobs)
2. Sätter upp sparse-checkout för senaste 12 månader
3. Skapar lokal SQLite-cache i `<dir>/.ava/cache.db`
4. Skriver ut nästa steg (env-vars + dev/build-kommandon)

## 5. Konfiguration på klient-sidan

`~/.ava/config` (eller env-vars):

```bash
AVA_REPO_DIR="/path/to/cloned/repo"
AVA_USER="anna@firma.se"
DATABASE_URL="file:/path/to/cloned/repo/.ava/cache.db"
```

Tauri-appen läser dessa vid start och bygger en `LocalRuntime`:

```ts
// src-tauri side (TS-runtime, inte Rust)
const runtime = LocalRuntime.create({
  fs: new NodeFileSystem(process.env.AVA_REPO_DIR!),
  git: new NodeGitOps(process.env.AVA_REPO_DIR!, process.env.AVA_USER!, process.env.AVA_USER!),
  prisma: new PrismaClient(),  // använder DATABASE_URL från env
  me: process.env.AVA_USER!,
  onHydrated: async (entity, data, path) => {
    // Re-hydrate SQLite från ändrade JSON-filer (kommer i nästa iteration)
  },
});
runtime.startSync();
```

## 6. Felsökning

| Problem | Åtgärd |
|---|---|
| `git push` ger `Permission denied (publickey)` | SSH-key inte i `authorized_keys` på servern eller fel användare |
| Tauri-bygg fail:ar med `tauri-build` linkage-fel | Kör `rustup update` och `yarn add -D @tauri-apps/cli@latest` |
| SQLite-fil låst | Bara en process ska skriva åt gången. Stäng andra Tauri-instanser. |
| `migrate:pg-to-git` ger `Prisma client not found` | `yarn prisma generate` mot postgres-schemat först |
| Tomma rader i events-loggen efter pull | Sparse-checkout har inte hämtat årets mapp. Lägg till år i `.git/info/sparse-checkout`. |

## 7. Vad som ÄR och INTE är klar

**Klart (i kod):**
- `LocalRuntime` composition root + tester
- `PostgresExporter` med felsamling
- `NodeFileSystem` + `NodeGitOps` mot riktig git
- `SyncLoop` med fetch → hydrate
- `WriteThroughProjector` event-driven projektion
- `YjsTextField` för konflikt-fri CRDT på fri-text
- SQLite-schemagenerator
- Tauri-scaffolding (Cargo.toml, src-tauri/, tauri.conf.json, lib.rs)
- Bootstrap-skript för end-user setup

**Kvarstår:**
- ⬜ Tiptap/CodeMirror-binding för Yjs i UI-lagret (Step 7b)
- ⬜ Hydrate-on-pull → SQLite-upsert via Prisma (callback-implementation)
- ⬜ Återstående entitet-projektioner (document, invoice, time-entry, expense)
- ⬜ Faktisk Tauri-bygg och signering (kräver Rust + plattforms-cert)
- ⬜ Auto-update via Tauri Updater
