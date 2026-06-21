# AVA Helper UI (Electron tray-app)

Menyrads-/systemfälts-skal runt Bun-helper-motorn (`helper-app/`), så icke-
tekniska användare kan installera + logga in via **ikon + knapp** i st.f.
kommandoraden. ADR 0029.

Skalet är tunt: det **startar + övervakar motorn**, pollar dess `/status` och
visar synk-läget i menyraden, och har en meny för *Logga in* (loopback-PKCE),
*Sök efter uppdatering* och *Avsluta*. All icke-Electron-logik ligger i de
testade modulerna (`tray-status`, `status-poller`, `engine`).

## Utveckla / köra lokalt

```bash
# 1. bygg motor-binären (helper-app) — skalet startar den
(cd ../helper-app && bun build.ts)

# 2. installera + kör skalet
bun install
AVA_OIDC_ISSUER=http://localhost:8089/realms/ava bun run dev
```

`bun run dev` buntlar `src/main.ts` → `dist/main.cjs` och startar Electron.
Ikonen dyker upp i menyraden; tooltip/meny speglar motorns status.

## Paketera (`.app` / `.exe`)

```bash
(cd ../helper-app && bun build.ts)   # motor-binärer i helper-app/dist/
bun run dist                          # electron-builder → dist/installers/
```

- **macOS:** `dist/installers/AVA Helper-<ver>-arm64.dmg`
- **Windows:** NSIS-`.exe` (kräver den windows-byggda motorn).

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
(default 48765). Utan issuer visar *Logga in* numera ett **felmeddelande** i
stället för att misslyckas tyst.

Hur configen levereras till icke-tekniska användare i skala (bakad per byrå /
Inställnings-vy som skriver filen / hämtad från web-appen) är fortsatt en öppen
fråga i ADR 0029.
