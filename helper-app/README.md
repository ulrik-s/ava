# ava-helper

Liten localhost-bryggar-app som låter AVA-webbappen öppna dokument i
användarens native-editorer (PDF Gear, Word, Preview, …) och automatiskt
synka tillbaka ändringar till AVA-servern.

Skriven i **TypeScript** och kompilerad till en fristående binär med
`bun build --compile` (ADR 0005 §Språk: all icke-frontend-kod i TS med
samma kod-/arkitektur-regler som resten av repot, #78). Request-/
response-protokollet delas med webbappen via
[`../src/lib/shared/helper/protocol.ts`](../src/lib/shared/helper/protocol.ts)
— en enda källa till sanning så helpern och `use-helper.ts` aldrig glider
isär.

## Vad den gör

* Lyssnar på `127.0.0.1:48761` (inga externa portar)
* `POST /open` — laddar ner en fil, öppnar den med OS:ets default-app,
  pollar `lastModified` och PUT:ar ändrade bytes tillbaka när användaren
  sparar.
* `GET /ping` / `GET /version` — så AVA-webbappen kan upptäcka helpern
  och visa version.
* Självuppdaterar sig en gång per dygn mot GitHub releases. När en ny
  version finns laddas binären ner, ersätts och processen exitar — då
  startar service-runnern (launchd/systemd/Task Scheduler) om den med
  nya bytsen.

## Säkerhet

* Bind till `127.0.0.1` — ingen extern access
* CORS-whitelist: `http://localhost:*`, `*.github.io`, plus eventuella
  egna origins via `AVA_HELPER_ORIGINS=https://firma.ava.se,…`
* Filer skrivs till per-session-tempkatalog under `os.TempDir()` med
  läs/skriv-skydd 0700
* Filnamn valideras (ingen path-traversal)

## Bygg & kör lokalt

```bash
cd helper-app
bun install
bun run start           # kör direkt (dev), startar på 127.0.0.1:48761
bun test                # kör testerna
bun run typecheck       # tsc mot ../tsconfig.json (samma regler som repot)

# Kompilera fristående binärer (en per plattform) → dist/
bun run build           # baka in version "dev"
bun build.ts helper-v1.0.0   # baka in en konkret version

./dist/ava-helper-darwin-arm64 --version
```

`build.ts` cross-kompilerar till alla 5 målplattformar (mac arm64/x64,
linux arm64/x64, windows x64) och namnger binärerna
`ava-helper-<os>-<arch>` — samma namn som självuppdateringen
(`src/update.ts`) letar efter i GitHub-releasen.

## Installera

| OS | Kommando |
|---|---|
| macOS | `bash service/install-macos.sh` |
| Linux | `bash service/install-linux.sh` |
| Windows | `powershell -File service\install-windows.ps1` |

Script:en kopierar binären till user-writable plats, registrerar
service-units och startar processen. Inga sudo/admin-rättigheter
behövs.

På **macOS** installerar scriptet även helperns lokala CA i login-keychain
(`ava-helper --install-trust`) så Safari/WKWebView (Office-add-ins) litar på
HTTPS-loopback-certet — det ger en engångs-auktoriseringsprompt (ADR 0006).
Chrome/Edge/Firefox + Windows/Linux behöver inte detta (HTTP-loopback funkar).

## Avinstallera

| OS | Kommando |
|---|---|
| macOS | `~/Library/Application\ Support/AVA/ava-helper --uninstall-trust; launchctl unload -w ~/Library/LaunchAgents/se.ava.helper.plist && rm "$_"` |
| Linux | `systemctl --user disable --now ava-helper` |
| Windows | `schtasks /delete /tn "AVA Helper" /f` |

## Release-process

Helper-releaser är taggade `helper-vX.Y.Z` (separerat från web-app-
releaser). Skicka in en tag → GitHub Actions (`helper-release.yml`) kör
`bun build.ts <tag>` → 5 binärer + `checksums.txt` laddas upp till
releasen → installerade helpers plockar upp den vid nästa daglig
kontroll (`src/update.ts`).

```bash
git tag helper-v1.0.0
git push origin helper-v1.0.0
```

> **Paketering:** install-scripten under `service/` letar efter en binär
> som heter `ava-helper` (resp. `ava-helper.exe`). Release-arkiveringen
> (per-plattform-tarball med rätt binär-namn + `service/`) hör till
> installer-/release-arbetet i #86/#87.

## Loggar

| OS | Sökväg |
|---|---|
| macOS | `~/Library/Logs/AVA/helper.log` |
| Linux | `journalctl --user -u ava-helper -f` |
| Windows | `%LOCALAPPDATA%\AVA\Logs\helper.log` |
