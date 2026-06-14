# ADR 0013 — Office-add-in-arkitektur: tunn server med git-db + HTTP-API, add-ins som tunna klienter

- **Status:** Accepterad (reviderad 2× 2026-06-13 — se "Ändringshistorik")
- **Datum:** 2026-06-13
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** server-runtime (ADR 0005, #80/#82), Office-add-ins (#83 plattform, #84 Word, #72 Outlook), git-db-åtkomst för native-klienter
- **Issue:** [#83](https://github.com/ulrik-s/ava/issues/83)
- **Relaterat:** [ADR 0001](./0001-pluggbar-backend-bakom-idatastore.md) (pluggbar backend-seam), [ADR 0002](./0002-git-konflikthantering-backend-a.md) (git-konflikt: last-write-wins), [ADR 0005](./0005-server-som-git-peer.md) (server som git-peer / `GitBackendRuntime`), [ADR 0009](./0009-oidc-login-via-servern.md) (auth)

## Kontext

Advokater vill arbeta i Word (#84) och Outlook (#72) men koppla mot AVA: infoga
ärende-/klient-/malldata och spara dokument/mail tillbaka till ärendets git-db.
Office-add-ins är Office.js-appar med samma grundbehov → bygg grunden en gång
(#83), så blir host-add-insen tunna feature-lager.

**Problem:** att köra AVA:s git-db-klient (isomorphic-git mot browser-storage)
*inuti* add-in-webviewen är opålitligt cross-platform — IndexedDB/OPFS-stöd och
cross-origin-push (CORS) varierar mellan WebView2 (Windows) och WKWebView
(macOS) och mellan Office-värdar. Att i stället bryggas via den lokala helpern
binder add-ins till att helpern är installerad + loopback-HTTPS per OS.

**Drivande krav:** add-ins ska funka **på alla plattformar** med minsta möjliga
klient-antaganden. Den enklaste gemensamma nämnaren är att add-in:en bara gör
**HTTP-anrop** — något varje webview klarar.

## Beslut

### 1. Den tunna servern äger git-db:n och exponerar den över HTTP (A1)

Den tunna servern (self-hosted) kör redan **server-runtime:n** (ADR 0005) med
domän-routrarna in-process mot en `firma.git`-working-copy (`GitBackendRuntime`,
för Fortnox-/avpricknings-/påminnelse-jobben). **Vi exponerar samma routrar över
HTTP** — tRPC-over-HTTP (`httpBatchLink`-server) — på serverns origin (bakom
nginx-fronten, ADR 0009). Det är "REST-likt" (HTTP + JSON) men återanvänder
routrar + zod-scheman + end-to-end-typer utan reimplementation (A1, INTE ett
handskrivet REST-lager).

**Add-ins är tunna tRPC/HTTP-klienter** (`httpBatchLink`) — de äger ingen git-db,
kör ingen iso-git, behöver inget filsystem/OPFS. De anropar serverns API; servern
gör mutationen mot sin working-copy och pushar. Fungerar i vilken webview som
helst på vilken plattform som helst.

```
Office-add-in (Office.js, vilken webview/OS som helst)
   │  tRPC-over-HTTP (httpBatchLink) + Authorization: Bearer <PAT>
   ▼
nginx-front (ADR 0009)  →  AVA-server (server-runtime, ADR 0005)
   │  tRPC-routrar in-process (GitBackendRuntime) → firma.git-working-copy
   ▼
firma.git
```

- **Helpern är inte inblandad** i add-in-datavägen (förblir den tunna
  doc/mail-brokern för web-appen: `/open`, `/compose-mail`).
- Add-ins bär **ingen git-db-kod** → liten bundle; ingen `@ava/core`-utbrytning
  tvingas fram (delar bara tRPC-klient-typer, ej hela klienten — under #85:s
  trigger).

### 2. Web-appen + demo förblir lokal-först — HTTP-API:t är additivt (B1)

Web-appen och GH Pages-demon är **oförändrade**: browsern äger sin OPFS-klon och
kör tRPC **in-process** (`inProcessLink`) — ingen HTTP-väg, ingen obligatorisk
server. HTTP-API:t finns BARA för native-klienter (add-ins) som inte kan köra
browser-git-db:n. USP:n (browsern är runtime, server "så tunn det går",
demo/lokal-först) bevaras (se [[project-usp-constraints]]).

Det betyder att **server-runtime:ns working-copy är ännu en git-peer** vid sidan
av webbens OPFS-klon — flera peers mot samma `firma.git` hanteras oförändrat av
last-write-wins + git-merge ([ADR 0002](./0002-git-konflikthantering-backend-a.md)).

### 3. Auth: Bearer-token mot API:t (C1)

Add-in är en egen origin → OIDC-cookien (ADR 0009) följer inte med. API:t
auktoriseras med ett **Bearer-token (PAT)**: add-in:en skickar
`Authorization: Bearer <PAT>`; servern validerar mot en principal (samma
maskin-/CLI-principal-väg som ADR 0009 lämnar för icke-browser-klienter). Commit-
författare härleds ur principalen. OIDC-i-webview (egen login-popup) är en
framtida uppgradering. **MS Graph-token** (Office-sidans data) är ortogonal.

### 4. Omfattning av #83: full delad shell + båda manifesten (3B)

#83 bygger **hela grunden**:
- **Server-sidan:** exponera tRPC-routrarna över HTTP i server-runtime:n +
  Bearer-auth-grind.
- **Add-in-sidan:** delad Office.js **task-pane-shell** med en tRPC-HTTP-klient
  (`httpBatchLink` mot serverns API) + **add-in-manifest per host** (Word +
  Outlook), HTTPS-serverad bundle.

Då blir **#84 (Word)** och **#72 (Outlook)** tunna feature-lager.

## Konsekvenser

- **+** **Cross-platform med minsta klient-antaganden:** add-ins gör bara
  HTTP-anrop → funkar i WebView2/WKWebView/alla Office-värdar utan
  storage/OPFS/CORS-/iso-git-beroenden.
- **+** **Återanvänder routrar + scheman** (A1) — end-to-end-typer, ingen
  reimplementation, inget brygg-/proxy-lager, ingen `@ava/core`-tvång.
- **+** **USP bevarad** (B1): web-app + demo förblir lokal-först/in-process;
  API:t är additivt och bara för native-klienter.
- **+** En enda git-db-skrivare för add-ins (serverns working-copy) → enkel
  författare-/konflikt-modell.
- **−** **Server-runtime:n får en HTTP-API-yta** (kör redan routrarna in-process;
  deltat är att exponera dem + auth-grind) — ett steg från "ren nginx +
  git-http-backend", men additivt och bara aktivt när add-ins/native-klienter
  används.
- **−** Add-ins kräver en **nåbar server** (de är inte offline-fristående som en
  browser-OPFS-klient) + ett **PAT**.
- **−** Server-working-copy + webb-OPFS-klon är två peers mot samma remote → ADR
  0002 last-write-wins; en öppen webbflik kan behöva refresh för att se
  add-in-ändringar.

## Alternativ (förkastade)

- **Add-in som git-medveten klient (importerar web-appens lib, kör iso-git i
  webviewen)** — *tidigare valt, nu ersatt*. Förutsatte att add-in-webviewen
  pålitligt kör browser-git-db (IndexedDB/OPFS) + cross-origin-push (CORS), vilket
  varierar per host/OS → opålitligt cross-platform. Servern-äger-git-db tar bort
  det antagandet helt: add-in:en är en dum HTTP-klient.
- **Helpern som git-peer + loopback-brygga (1B)** — *ursprungligt beslut*. Binder
  add-ins till lokalt installerad helper + loopback-HTTPS per OS; server-API:t är
  mer generellt och plattformsoberoende.
- **Allt via server-API:t (även web-appen, B2)** — bryter USP:n (server blir
  obligatorisk app-server, demo/lokal-först faller). Web-appen förblir
  lokal-först (B1).
- **Handskrivet REST-lager (A2)** — rent språk-agnostiskt kontrakt men dubbel yta
  + reimplementation. tRPC-over-HTTP (A1) räcker eftersom add-ins är AVA-klienter,
  inte tredje part.

## Concurrency (beslut A, 2026-06-13)

Server-runtime:ns HTTP-API och dess peer-loop (15 s pull→act→push) arbetar mot
**samma** `firma.git`-working-copy. För att aldrig skriva git samtidigt
serialiseras de via **ett delat async-lås (Mutex)** — beslut **A** av tre:

- **A (valt):** en working-copy + ett delat lås. Enklast, en skrivare i taget,
  återanvänder commit/push-vägen. Add-in-trafik är låg-QPS → kostnaden trivial.
  Per HTTP-mutation (inuti låset): fetch+reset → hydrera → kör → commit+push
  (bara POST, bara vid faktisk ändring).
- **B (förkastat):** klon per request — ingen kontention men dyrt + fler peers
  mot remote (mer last-write-wins-churn). Överdrivet vid add-in-QPS.
- **C (förkastat):** köa mutationer in i peer-loopens act-fas — eventual/async,
  ger upp till intervallets latens på en interaktiv "spara". Fel trade-off.

Levererat i tre steg: **1** (PR #283) transport + Bearer-PAT-grind; **1b**
(PR #286) Mutex + `openSession`/`finalize`-seam + working-copy-session +
peer-loop-låsinjektion; **1c** HTTP-listener i server-runtime-processen
(node:http) + nginx `/api/`-proxy + docker + PAT-provisioning via env.

## Ändringshistorik

- **2026-06-13 (rev 1):** Datatväg 1B (helpern som git-peer + loopback-brygga) →
  add-in:en som git-medveten klient som importerar web-appens lib.
- **2026-06-13 (rev 2, gällande):** → **tunn server äger git-db + exponerar tRPC-
  over-HTTP; add-ins är tunna HTTP-klienter med Bearer-PAT (A1+B1+C1)**. Skäl:
  enklaste cross-platform-modellen (add-in = dum HTTP-klient, inga
  webview-storage/CORS-antaganden); web-app/demo förblir lokal-först (USP intakt).
  Inget hade byggts på de tidigare varianterna.
- **2026-06-14 (scope-avgränsning):** **Word-add-in (#84) borttagen** — AVA
  behöver bara **Outlook** (#72). Plattformen (server-tRPC-over-HTTP + delad
  klient) är oförändrad men konsumeras nu av en enda host. Outlook-add-in:en har
  två funktioner: (1) spara inkommande mail → ärende + tidspost (kräver add-in);
  (2) maila ut ett ärende-dokument (web-app-funktion, ej add-in — triggas i AVA).
