# ADR 0013 — Office-add-in-arkitektur: helpern som git-peer + loopback-brygga

- **Status:** Accepterad
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

**Verifierade begränsningar:**
- Office-add-ins kör i en **sandboxad webview UTAN filsystem/OS-åtkomst** (alla
  plattformar) → kan inte köra OPFS/isomorphic-git → kan **inte** röra git-db
  direkt. Måste bryggas via helpern.
- På macOS (WebKit) krävs **HTTPS på loopback** (inte http) → helperns lokala
  CA måste vara betrodd (ADR 0006; installeras av `ava-helper --install`, #86).
- Git-db:n ägs idag av **web-appen** (OPFS-klon + iso-git). Helpern är hittills
  tier-agnostisk och äger inte git-db (bara `/open`, `/compose-mail`).

## Beslut

### 1. Datatväg: helpern blir en git-peer (1B)

**Helpern görs git-medveten** — den klonar en egen `firma.git`-working-copy och
kör **samma tRPC-routrar in-process** som webben och server-runtime:n, via
`GitBackendRuntime` (ADR 0005). Add-in:en pratar med helpern över
HTTPS-loopback; helpern kör mutationen mot sin working-copy och pushar.

```
Office-add-in (Office.js, task-pane)
   │  tRPC över HTTPS-loopback (127.0.0.1, helperns lokala CA)
   ▼
helper-app (Bun)  ──  GitBackendRuntime (samma routrar + zod-scheman, ADR 0001/0005)
   │  clone / pull → act → push  (git-peer, ADR 0005)
   ▼
firma.git (remote)
```

- Add-in:en innehåller en **`IDataStore`-bryggimplementation** som routar
  tRPC-anrop via HTTPS-loopback till helpern (ADR 0001:s seam) → domän-routrar +
  zod-scheman återanvänds, ingen reimplementation.
- Add-in:en fungerar **fristående** — ingen öppen AVA-webbflik krävs.

**Flera git-peers samexisterar** redan i modellen: webbens OPFS-klon,
server-runtime:n (#80/#82) och nu helpern är alla peers mot samma `firma.git`.
Konflikt-/sammanslagningshantering är **oförändrad** — last-write-wins +
git-merge per [ADR 0002](./0002-git-konflikthantering-backend-a.md). Helpern
inför alltså ingen ny konfliktmodell; den är "ännu en peer".

### 2. Auth: loopback-förtroende, författare = helperns identitet (2A)

OIDC-cookien (ADR 0009) följer inte in i Office-sandboxen. För v1:
- **Helpern litar på den lokala anroparen** (samma förtroende som dagens
  `/open` — helpern är användarens egen process på loopback).
- **Commit-författaren** tas från helperns konfigurerade/inloggade identitet
  (samma princip som server-runtime-principalen, ADR 0005) — INTE från
  add-in:en. Add-in:en bär ingen egen AVA-token i v1.
- **MS Graph-token** (för Office-sidans data: mail/kalender via Office.js) är
  **ortogonal** — den hämtas av add-in:en för Office-API:t och rör inte
  git-db-åtkomsten.

Per-användar-författarskap via add-in-token (alt 2B) är en framtida uppgradering
om/när flera jurister delar samma helper-värd.

### 3. Omfattning av #83: full delad shell + båda manifesten (3B)

#83 bygger **hela den delade grunden**:
- En delad Office.js **task-pane-shell** (UI-skal + helper-brygga + IDataStore-
  bryggan), återanvändbar av båda hosts.
- **Add-in-manifest per host** (Word + Outlook).
- Helpern **serverar add-in-bundlen över HTTPS-loopback** (CA-trust via #86).

Då blir **#84 (Word)** och **#72 (Outlook)** tunna feature-lager ovanpå shell:en.

## Konsekvenser

- **+** Add-ins fungerar fristående (ingen öppen webbflik) — robust UX.
- **+** Återanvänder backend-seam (ADR 0001) + git-peer-lagret (ADR 0005) →
  routrar/scheman delas, ingen reimplementation.
- **+** Allt lokalt/offline: helper-loopback servar både bundle och data; CA-
  trusten finns redan (#86).
- **+** #84/#72 blir tunna givet 3B.
- **−** Helpern får en **tyngre roll** (äger en working-copy, push/pull,
  remote-credential) — mer state + ansvar på klienten än dagens broker.
- **−** Två lokala git-peers (webbens OPFS-klon + helpern) kan skriva mot samma
  remote → hanteras av ADR 0002 (last-write-wins), men användaren kan behöva
  pull/refresh i webben för att se add-in-skapade ändringar.
- **−** Helpern behöver remote-credential för push (PAT/deploy-key, separat
  från människo-OIDC, jfr ADR 0009 maskin-principaler).
- **−** OS-kodsignering av helpern (#275) kvarstår oberoende.

## Alternativ (förkastade)

- **1A — `Add-in → helper → öppen web-app → git-db`:** kräver att en AVA-flik
  är öppen samtidigt → skör UX + "vilken flik"-tvetydighet. Helpern blir bara en
  proxy, men beroendet av en öppen webb gör den opålitlig. Nej.
- **1C — Add-in bäddar in web-appen (iframe) + använder OPFS direkt:** OPFS/iso-
  git i Office-WebView (WebKit) är oprövat/osäkert; CORS + cookie-isolering;
  samma dubbel-klon-konflikt som 1B men i en skörare miljö. Nej.
- **2B — Add-in bär egen AVA-token:** korrekt per-användar-författarskap men
  token-livscykel i Office-sandboxen är overkill för v1 (en helper-värd =
  en jurist). Uppskjutet.
- **3A — Word + minimal vertikal slice först:** mindre, men #84/#72 skulle få
  bygga shell-grunden ändå. Vi tar full shell direkt (3B) så host-add-insen blir
  tunna.
