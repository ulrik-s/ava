# ADR 0029 — Helper som Electron tray-app (UI runt offline-first-motorn)

- **Status:** Accepterad (2026-06-21)
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** helper-app, distribution/paketering, signering, auto-update, onboarding
- **Knyter an till:** [ADR 0028](0028-autonom-offline-first-helper.md) (autonom offline-first helper),
  [ADR 0006](0006-helper-https-lokal-ca.md) (lokal CA / keychain), [ADR 0005](0005-server-som-git-peer.md)
  (§Språk — all icke-frontend-kod i TS), [ADR 0013](0013-office-add-in-arkitektur.md) (tunna klienter).

## Kontext

Helpern (ADR 0028) är i dag en **headless Bun-binär**: en localhost-tjänst som
installeras/loggas in via terminal (`--install`, `--login`). Användarna —
jurister på advokatbyråer — har **inte teknisk nivå för kommandoraden**. De
behöver en **app med ikon** de dubbelklickar, en synlig **status** och en
**Logga in-knapp**.

Helpern är till sin natur en **tray-/menyrads-följeslagare** (à la Dropbox/
1Password mini), inte ett fönster-program: den kör i bakgrunden och pratar med
webbappen över localhost.

## Beslut

### 1. Ett **Electron-tray-skal** runt den befintliga Bun-motorn

- **Electron** (TS hela vägen → ADR 0005; Tauri/Rust avfärdat då det medvetet
  pensionerades och bryter språk-regeln). Tray + vid behov ett litet fönster.
- **Bun-motorn återanvänds oförändrad:** Electron paketerar den
  cross-byggda binären (`extraResources`) och **startar den som child-process**,
  övervakar den (omstart vid krasch), och dödar den vid avslut. All testad
  TS-logik (kö, content-store, /status, auth) lever kvar i motorn — Electron är
  ett **tunt skal** (supervisor + tray-UI), ingen omskrivning.
- **Tray-ikonen speglar `/status`** (synkat / N väntar / konflikt / ej ansluten)
  via polling mot localhost (samma API webbappen använder).
- **Meny:** *Logga in…* (startar `<binär> --login` som transient child → browsern
  öppnas, loopback-PKCE, ADR 0028 §2), *Sök efter uppdatering*, *Synk-status*,
  *Avsluta*. Login-invokationen skriver tokens i keychain:en; den körande motorn
  läser dem på nästa request (delad keychain → ingen ny endpoint behövs).
- **Autostart vid inloggning** (login item / Run-nyckel) så följeslagaren alltid
  finns när webbappen behöver den.

### 2. Plattformar: **macOS + Windows** (första versionen)

macOS är den bevisade prioriteten (keychain-trust, Safari-https — ADR 0006);
Windows täcker majoriteten av byråerna. Linux-tray (AppIndicator) skjuts upp.

### 3. Paketering: **electron-builder** → `.app` (mac) + NSIS-`.exe` (win)

- Ikon + appnamn + auto-update (`electron-updater` mot GitHub releases) — ersätter
  motorns egna self-update när den körs under skalet (skalet äger uppdateringen
  av både skal + medföljande motor).
- Signerings-konfig finns men är **avstängd tills cert finns** (se §4).

### 4. Signering: **uppskjuten** — osignerad nu, dokumenterad friktion

**Vi har inget signerings-cert just nu.** Osignerad app → Gatekeeper (macOS:
"Apple kan inte kontrollera…") / SmartScreen (Windows). Det är **OK för pilot/
intern utrullning** med tydliga instruktioner (högerklick → Öppna, eller
`xattr -dr com.apple.quarantine`), men **skrämmer icke-tekniska användare i
skala**. Plan:
- Nu: bygg osignerat; electron-builder-signering bakom en flagga/secret som
  no-op:ar utan cert. Dokumentera quarantine-workaround i onboarding.
- Före bred utrullning: **Apple Developer ID** (notarisering) + **Windows
  Authenticode/EV** — då slås signeringen bara på i release-bygget.

## Konsekvenser

- **Icke-tekniska användare kan installera + logga in** via ikon + knapp; ingen
  terminal. Status syns alltid i menyraden — offline-sparningar är aldrig osynliga.
- **Ingen omskrivning:** motorn (Bun) är oförändrad; skalet är tunt. Risk isoleras
  till skal + paketering.
- **~100 MB runtime per app** (accepterat). Tyngre än en ren binär men ger mogen
  tray/paketering/updater på båda plattformarna med en TS-kodbas.
- **Två release-artefakter till** (mac/win-installers) → CI-bygget växer
  (`helper-release`-workflowen utökas).
- **Osignerat först** → Gatekeeper/SmartScreen-friktion tills cert skaffas; måste
  stå tydligt i onboarding.

## Genomförande (en PR per steg)

1. **Electron-skal-MVP** (`helper-ui/`): tray + status-polling (`/status`,`/ping`)
   + meny (login/uppdatering/avsluta) + spawn/övervaka Bun-motorn. Testbar
   tray-/status-logik separerad från Electron-API:t.
2. **Paketering** (electron-builder): `.app` + NSIS-`.exe`, ikon, `extraResources`
   = motor-binären, signerings-konfig bakom flagga (no-op utan cert).
3. **Autostart** (login item / Run-nyckel) + ersätt motorns self-update med
   `electron-updater` när den körs under skalet.
4. **CI**: bygg installers i `helper-release`-workflowen (osignerat tills cert).
5. **Onboarding-doc**: installera + Gatekeeper/SmartScreen-workaround + logga in.

## Öppna frågor

- **Config-leverans:** icke-tekniska användare sätter inte `AVA_OIDC_ISSUER` /
  server-URL. Alternativ: bakas per-byrå i bygget, en engångs-*Inställningar*-vy i
  skalet, eller hämtas från webbappen vid första paring. Beslutas i steg 1–2.
- **Signerings-cert:** vem/när skaffar Developer ID + Authenticode (kostnad +
  ägare). Blockerar inte bygget men bred utrullning.

## Relaterat

ADR 0028 (motorn skalet lindar), 0006 (keychain/CA), 0005 (TS-only), 0013.
Föranlett av att målgruppen (jurister) inte kör kommandoraden.
