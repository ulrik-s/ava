# AVA Helper (Electron tray-app)

Menyrads-/systemfälts-app som låter icke-tekniska användare installera + logga
in via **ikon + knapp** i st.f. kommandoraden. ADR 0029/0030.

**Ett paket, en runtime.** Motorn (kö, content-store, OIDC-auth,
`/open`/`/content`/`/config`-servern) körs **in-process i Electrons Node-process**
— ingen medföljande binär, ingen child-process (ADR 0030). Skalet startar motorn
(`startEngine`), pollar dess `/status` och visar synk-läget i menyraden, och har
en meny för *Logga in* (loopback-PKCE, in-process), *Sök efter uppdatering* och
*Avsluta*.

Layout:

- `src/engine/` — motorn (körs in-process; körs även **headless** utan Electron).
- `src/main.ts` — det tunna Electron-limmet (tray + meny).
- `src/status-poller.ts`, `src/tray-status.ts` — Electron-fri presentations-logik.

## Utveckla / köra lokalt

```bash
bun install
AVA_OIDC_ISSUER=http://localhost:8089/realms/ava bun run dev
```

`bun run dev` buntlar `src/main.ts` (+ den inbäddade motorn) → `dist/main.cjs`
och startar Electron. Ikonen dyker upp i menyraden; tooltip/meny speglar motorns
status.

### Köra motorn headless (utan Electron)

Hela poängen med konsolideringen: motorn kan köras + debuggas utan GUI.

```bash
AVA_HELPER_PORT=48911 bun src/engine/main.ts   # startar HTTP(S) på localhost
curl http://127.0.0.1:48911/ping               # → "ava-helper <ver>"
curl http://127.0.0.1:48911/status             # → kö-snapshot
```

CLI-flaggor: `--login`, `--version`, `--install`/`--uninstall`,
`--install-trust`/`--uninstall-trust`.

## Paketera (`.app` / `.exe`)

```bash
bun run dist   # icons + bundle + electron-builder → dist/installers/
```

- **macOS:** `dist/installers/AVA Helper-<ver>-arm64.dmg`
- **Windows:** NSIS-`.exe`.

Ingen separat motor-binär att bygga först — motorn ligger i `dist/main.cjs`.

## Self-update

Skalet kollar GitHub releases och visar **"Ny version finns — ladda ner"** i
menyraden (öppnar release-sidan); användaren installerar manuellt. Tyst
auto-update (electron-updater/Squirrel.Mac) kräver signering och skjuts upp till
cert finns (ADR 0030 §2).

## Signering (ej på plats än, ADR 0029 §4)

Bygget är **osignerat** (inget Developer ID / Authenticode-cert ännu). Därför:

- **macOS Gatekeeper:** första gången — högerklicka appen → *Öppna*, eller kör
  `xattr -dr com.apple.quarantine "/Applications/AVA Helper.app"`.
- **Windows SmartScreen:** *Mer info* → *Kör ändå*.

Slå på signering i release-bygget när cert finns (electron-builder `mac.identity`
/ Authenticode-secrets); konfigen no-op:ar utan cert (`CSC_IDENTITY_AUTO_DISCOVERY=false`).

## Konfiguration

En app startad **från Finder/Applications ärver inte ditt shell-env**, så
`AVA_OIDC_ISSUER` är inte satt där. Motorn läser därför även en **config-fil**:

```
~/Library/Application Support/AVA/helper-config.json
```
```json
{ "oidcIssuer": "http://localhost:8089/realms/ava" }
```

(env vinner över filen — så `bun run dev` med `AVA_OIDC_ISSUER` satt fungerar
också). Fält: `oidcIssuer` (krävs för *Logga in*), valfria `oidcClientId`
(default `ava-helper`), `oidcAudience`, `oidcJwksUri`, `oidcScope`, `redirectPort`
(default 48765). Utan issuer visar *Logga in* ett **felmeddelande** i stället för
att misslyckas tyst.

Web-appen **auto-konfigurerar** helpern (zero-touch): den postar
`POST /config` → motorn skriver `helper-config.json`. Se ADR 0029.
