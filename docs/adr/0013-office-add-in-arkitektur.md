# ADR 0013 — Office-add-in-arkitektur: add-in:en är en git-medveten AVA-klient

- **Status:** Accepterad (reviderad 2026-06-13 — se "Ändringshistorik")
- **Datum:** 2026-06-13
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** helper-appen (#78/#86/#110), Office-add-ins (#83 plattform, #84 Word, #72 Outlook), git-db-åtkomst
- **Issue:** [#83](https://github.com/ulrik-s/ava/issues/83)
- **Relaterat:** [ADR 0001](./0001-pluggbar-backend-bakom-idatastore.md) (pluggbar backend-seam), [ADR 0002](./0002-git-konflikthantering-backend-a.md) (git-konflikt: last-write-wins), [ADR 0005](./0005-server-som-git-peer.md) (server som git-peer / `GitBackendRuntime`), [ADR 0006](./0006-helper-https-lokal-ca.md) (helper-HTTPS via lokal CA), [ADR 0009](./0009-oidc-login-via-servern.md) (auth)

## Kontext

Advokater vill arbeta i Word (#84) och Outlook (#72) men koppla mot AVA:
infoga ärende-/klient-/malldata och spara dokument/mail tillbaka till ärendets
git-db. Office-add-ins är Office.js-appar med samma grundbehov → bygg grunden
en gång (#83), så blir host-add-insen tunna feature-lager.

**Förutsättningar:**
- Office-add-ins kör i en **browser-webview** (WebView2 på Windows, WKWebView på
  macOS) utan OS-filsystem — MEN med browser-storage-API:er (IndexedDB, ev.
  OPFS) och `fetch`. Det är samma miljö som AVA-web-appen använder för sin
  self-hosted-klon (isomorphic-git mot browser-storage). Add-in:en kan alltså
  **själv köra git-db:n** precis som web-appen — den behöver ingen helper-brygga
  för data.
- Git-db-klienten + domän-routrarna + zod-scheman lever redan i web-appens
  `src/lib` (ADR 0001:s seam; tRPC in-process via `GitBackendRuntime`/`inProcessLink`).
  Add-in:en **importerar den delade koden** i stället för att reimplementera.
- Push mot `firma.git`-remoten sker över HTTPS (samma som web-appens
  self-hosted-läge). Add-in:en är en egen origin → OIDC-cookien (ADR 0009) följer
  INTE med automatiskt; auth-credential för push måste lösas explicit (se beslut 2).

## Beslut

### 1. Datatväg: add-in:en är en git-medveten AVA-klient (INGEN helper)

Add-in:en kör **AVA:s git-db-klient själv** — samma kod som web-appen i
self-hosted-läge. Den **importerar den delade lib:en** (IDataStore/`DemoDataStore`
+ iso-git-klienten + tRPC-routrarna + zod-scheman ur web-appens `src/lib`),
klonar `firma.git` till add-in-webviewens browser-storage, kör routrarna
in-process (`GitBackendRuntime`/`inProcessLink`, ADR 0005) och pushar till
remoten över HTTPS. **Helpern är inte i datatvägen.**

```
Office-add-in (Office.js, task-pane)  ──  importerar AVA:s src/lib
   ├─ git-db-klient (iso-git mot browser-storage)  ← samma som web-appen
   ├─ tRPC in-process (GitBackendRuntime, ADR 0005) → domän-routrar + zod
   └─ Office.js för dokument-/mail-sidan (insert/läs)
        │  clone / pull → act → push (HTTPS)
        ▼
   firma.git (remote)
```

- **Ingen helper-brygga, ingen helper-git-peer.** Add-in:en är "ännu en
  AVA-klient" precis som en web-flik — fristående.
- **Kod-import = #85:s trigger.** En andra bundler (add-in) som delar MER än
  kontrakt (hela git-db-klienten + routrarna) är exakt den situation [#85](https://github.com/ulrik-s/ava/issues/85)
  pekade ut. Per #85: gör det lazily — börja med `@/`-path-alias; om aliaset
  läcker (add-in-bundlern drar av misstag in Next/server-only-kod) bryt ut ett
  **source-only `@ava/core`** (inga dist/builds). dep-cruiser-regler bevakar
  gränsen oavsett.
- **Flera git-peers** (web-OPFS-klon, server-runtime, add-in-klon) mot samma
  remote → oförändrad konflikt-hantering, last-write-wins + git-merge
  ([ADR 0002](./0002-git-konflikthantering-backend-a.md)).

### 2. Auth: add-in:en autentiserar sin egen push (egen origin)

OIDC-cookien (ADR 0009) följer inte med till add-in-originen. Add-in:en behöver
ett eget push-credential mot `firma.git`:
- **v1: PAT/deploy-key i add-in:ens storage** (samma maskin-/klient-principal-
  väg som ADR 0009 lämnar för icke-browser-git — anges en gång, lagras i
  add-in-webviewens storage). Commit-författare härleds ur den principalen.
- **Senare: OIDC i add-in-webviewen** (egen oauth2-proxy-login i en dialog/popup)
  för fullständig människo-auth — uppskjutet (mer Office.js-dialog-arbete).
- **MS Graph-token** (Office-sidans data: mail/kalender via Office.js) är
  **ortogonal** mot git-db-pushen.

*(Detta är den kvarvarande sub-frågan att spika vid implementation: PAT-i-storage
för v1 vs OIDC-i-webview. Lutar åt PAT för v1.)*

### 3. Omfattning av #83: full delad shell + båda manifesten (3B)

#83 bygger **hela den delade grunden**:
- En delad Office.js **task-pane-shell** (UI-skal + den importerade git-db-
  klienten + tRPC-in-process-uppsättningen), återanvändbar av båda hosts.
- **Add-in-manifest per host** (Word + Outlook), HTTPS-serverad bundle.
- Mekanismen att **importera/dela web-appens `src/lib`** in i add-in-bundlern
  (alias eller `@ava/core` om aliaset läcker, jfr #85).

Då blir **#84 (Word)** och **#72 (Outlook)** tunna feature-lager ovanpå shell:en.

## Konsekvenser

- **+** Add-ins fungerar **fristående** (ingen öppen webbflik, ingen helper i
  datatvägen) — robust UX, en arkitektur (add-in = AVA-klient).
- **+** Maximal kod-återanvändning: add-in:en importerar web-appens git-db-
  klient + routrar + scheman rakt av (ADR 0001-seam) — ingen brygg-/proxy-kod,
  ingen reimplementation.
- **+** Helpern slipper en git-peer-roll — förblir den tunna doc/mail-brokern
  (`/open`, `/compose-mail`). Mindre klient-state.
- **+** #84/#72 blir tunna givet 3B.
- **−** **Teknisk risk att validera tidigt:** add-in-webviewen måste faktiskt
  stödja browser-storage (IndexedDB/OPFS) för iso-git-klonen + tillåta
  cross-origin HTTPS-push (CORS) mot `firma.git`-remoten. Detta är miljön
  ADR:ns ursprungliga version undvek via helpern — det är nu ett antagande som
  ett tidigt spike-steg i #83 ska bekräfta per host (WebView2/WKWebView).
- **−** **Push-auth utan same-origin-cookie:** add-in:en måste bära ett eget
  credential (PAT i storage för v1) — ett credential i webview-storage (mindre
  bra än helperns process-förtroende, men lokalt på användarens maskin).
- **−** Add-in:en drar in **hela git-db-klienten** i sin bundle → större bundle
  + #85:s alias-/`@ava/core`-fråga aktiveras (hanteras lazily, se beslut 1).
- **−** Flera git-peers (web + add-in + server-runtime) → ADR 0002 last-write-
  wins; användaren kan behöva refresh i en öppen webbflik för att se add-in-
  ändringar.

## Alternativ (förkastade)

- **1B (tidigare valt, nu ersatt) — helpern blir git-peer, add-in → helper-
  loopback → git-db:** undviker att köra git-db i add-in-webviewen, men ger
  helpern en tung git-peer-roll + en brygg-/proxy-väg + helper-credential.
  Ersatt: add-in-som-klient ger en enklare, enhetlig arkitektur (add-in = samma
  AVA-klient som webben) och slipper helper-git-peer-komplexiteten. Risken
  flyttas till "funkar git-db i webviewen?" (valideras i #83-spiken).
- **1A — `Add-in → helper → öppen web-app → git-db`:** kräver att en AVA-flik är
  öppen samtidigt → skör UX. Nej.
- **3A — Word + minimal vertikal slice först:** vi tar full shell direkt (3B) så
  host-add-insen blir tunna.

## Ändringshistorik

- **2026-06-13 (revidering):** Datatvägen ändrad från **1B (helpern som git-peer
  + loopback-brygga)** till **add-in:en som git-medveten AVA-klient som importerar
  web-appens lib** (ingen helper i datatvägen). Auth-beslutet (2) ändrat från
  loopback-förtroende till add-in:ens egna push-credential (PAT v1). Inget hade
  byggts på 1B-beslutet. Skäl: enklare, enhetlig arkitektur (add-in = AVA-klient);
  helpern hålls tunn. Ny risk att validera: git-db i add-in-webviewen.
