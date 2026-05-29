# ava-helper

Liten localhost-bryggar-app som låter AVA-webbappen öppna dokument i
användarens native-editorer (PDF Gear, Word, Preview, …) och automatiskt
synka tillbaka ändringar till AVA-servern.

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

## Bygg lokalt

```bash
cd helper-app
go build .
./ava-helper --version
./ava-helper            # startar på 127.0.0.1:48761
```

## Installera

| OS | Kommando |
|---|---|
| macOS | `bash service/install-macos.sh` |
| Linux | `bash service/install-linux.sh` |
| Windows | `powershell -File service\install-windows.ps1` |

Script:en kopierar binären till user-writable plats, registrerar
service-units och startar processen. Inga sudo/admin-rättigheter
behövs.

## Avinstallera

| OS | Kommando |
|---|---|
| macOS | `launchctl unload -w ~/Library/LaunchAgents/se.ava.helper.plist && rm "$_"` |
| Linux | `systemctl --user disable --now ava-helper` |
| Windows | `schtasks /delete /tn "AVA Helper" /f` |

## Release-process

Helper-releaser är taggade `helper-vX.Y.Z` (separerat från web-app-
releaser). Skicka in en tag → GitHub Actions kör `goreleaser` →
binärer + checksums laddas upp till releasen → installerade helpers
plockar upp den vid nästa daglig kontroll.

```bash
git tag helper-v1.0.0
git push origin helper-v1.0.0
```

## Loggar

| OS | Sökväg |
|---|---|
| macOS | `~/Library/Logs/AVA/helper.log` |
| Linux | `journalctl --user -u ava-helper -f` |
| Windows | `%LOCALAPPDATA%\AVA\Logs\helper.log` |
