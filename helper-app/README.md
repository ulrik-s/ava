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
* **Signerade self-updates (#110):** en nedladdad binär verifieras mot en
  inbyggd, pinnad Ed25519-pubkey innan byte. Ingen giltig signatur (eller ingen
  pinnad nyckel) → uppdateringen vägras och gamla binären behålls (fail-closed).
  Skyddar mot en komprometterad GitHub-release. Se nedan + `src/update-verify.ts`.

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

## Installera (#86)

**Self-install — ett kommando, samma binär på alla OS:**

```bash
./ava-helper --install      # registrera som user-service + (macOS) CA-trust
./ava-helper --uninstall    # avregistrera servicen
```

`--install` (beslut #86: self-install, ingen sudo, ingen .pkg/.msi/.deb):

1. kopierar binären till data-dir (`~/Library/Application Support/AVA`,
   `~/.local/share/AVA`, `%LOCALAPPDATA%\AVA`),
2. skriver service-definitionen (launchd-plist / systemd user-unit / Task
   Scheduler-XML) med absolut path till binären,
3. registrerar + startar servicen (`launchctl load` / `systemctl --user enable
   --now` / `schtasks /Create`) → startar vid login, lyssnar på loopback,
4. på **macOS** installerar helperns lokala CA i login-keychain
   (`--install-trust`, ADR 0006) så Safari/WKWebView (Office-add-ins) litar på
   HTTPS-loopback-certet (engångs-auktoriseringsprompt). Chrome/Edge/Firefox +
   Windows/Linux behöver inte detta.

Self-update (#78/#110) sköts sedan av den körande servicen.

> ⚠️ **Signering/notarisering (kvarstår, kräver dina certifikat):** för att köra
> UTAN OS-varningar måste binären vara **Apple Developer ID-signerad + notariserad**
> (macOS) resp. **Authenticode-signerad** (Windows). Det kräver byråns/utgivarens
> kodsignerings-certifikat och kan inte göras i koden — se uppföljnings-issue.
> Osignerad binär fungerar men ger en Gatekeeper-/SmartScreen-varning vid första
> körning.

De äldre shell-skripten under `service/` (`install-macos.sh` m.fl.) finns kvar
som referens men `--install` är den primära vägen.

## Avinstallera

`./ava-helper --uninstall` avregistrerar servicen på alla OS (launchctl unload /
systemctl --user disable / schtasks /Delete). Binär + data-dir lämnas kvar; ta
bort dem manuellt vid behov. På macOS: `--uninstall-trust` tar bort CA:n ur
keychain.

## Release-process

Helper-releaser är taggade `helper-vX.Y.Z` (separerat från web-app-
releaser). Skicka in en tag → GitHub Actions (`helper-release.yml`) kör
`bun build.ts <tag>` → 5 binärer + `checksums.txt` + en detached
`.sig` per binär laddas upp till releasen → installerade helpers
verifierar signaturen och plockar upp den vid nästa dagliga kontroll
(`src/update.ts`).

```bash
git tag helper-v1.0.0
git push origin helper-v1.0.0
```

### Release-signeringsnyckel (#110, engångs-setup)

Self-update kräver att binären är signerad med byråns release-nyckel.

```bash
# 1. Generera ett Ed25519-nyckelpar
openssl genpkey -algorithm ed25519 -out helper-release.key

# 2. Lägg PRIVATA nyckeln som GitHub Actions-secret HELPER_SIGNING_KEY
#    (Settings → Secrets → Actions). Hela PEM:en. Används bara i release-jobbet.

# 3. Härled PUBLIKA nyckeln (base64 DER SPKI) och baka in den i koden:
openssl pkey -in helper-release.key -pubout -outform DER | base64 -w0
#    → klistra i RELEASE_PUBLIC_KEY_SPKI_B64 i src/update-verify.ts
```

Tills nyckeln är inbakad **vägrar** nya helpers att uppdatera (fail-closed).
**Nyckelrotation:** släpp först en version som litar på både gammal + ny nyckel
(`acceptedPublicKeys` i `update-verify.ts`), låt flottan uppdatera, byt sedan
secret:en. Detaljer i filhuvudet på `src/update-verify.ts`.

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
