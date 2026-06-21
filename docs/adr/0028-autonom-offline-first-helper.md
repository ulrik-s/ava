# ADR 0028 — Autonom offline-first helper som lokal dokument-auktoritet (+ cache-policy)

- **Status:** Accepterad (2026-06-21)
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** helper-app, web-app content-store, auth, offline-UX, dokumentsök, jävskontroll, sync, cache-policy
- **Knyter an till / förfinar:** [ADR 0022](0022-working-set-scoping.md) (working-set-scoping),
  [ADR 0016](0016-server-first-med-offline-first-klient.md) (server-first + offline-first),
  [ADR 0017](0017-sync-reconcile-protokoll.md) (sync/reconcile), [ADR 0023](0023-dokument-bytes-content-adresserat.md)
  (content-adresserade bytes), [ADR 0013](0013-office-add-in-arkitektur.md) (tunn server + tunna klienter),
  [ADR 0009](0009-oidc-login-via-servern.md) (OIDC), [ADR 0006](0006-helper-https-lokal-ca.md)
  (helper-HTTPS via lokal CA), [ADR 0027](0027-kapabilitets-tierad-klient.md) (kapabilitets-tierad klient).

## Kontext

Helpern (lokal app som öppnar PDF/Word i externa editorer) byggde tidigare på att
**browsern koordinerar** öppna/spara-flödet (eller att helpern hämtar via servern).
Båda modellerna faller på **offline**: server-fetch kräver nät, och browser-
koordinering kräver att fliken är öppen och att dess minnes-state överlever (en
reload nollställer det). En befintlig produkt (KATS‑HIIT-pluginet) använder
browser-koordinering — och användarna är missnöjda, sannolikt för att begräns-
ningarna är **osynliga** och synken tyst slutar fungera.

**Hårt krav:** användaren ska kunna **öppna, ändra och spara dokument offline**
och *veta* att ändringarna inte är borta. Det utesluter både server-fetch (nät)
och browser-beroende (KATS‑HIIT-fällan).

Vidare: två oberoende offline-lager (web-appens IndexedDB-cache + ett helper-lager)
skulle kunna **divergera offline** på samma maskin → samma slags förvirring.

## Beslut

### 1. Helpern är en **autonom offline-first lokal dokument-auktoritet**

Helpern (inte browsern, inte servern) äger dokument-redigerings-livscykeln:
- **Durabelt, content-adresserat lokalt lager** (ADR 0023-princip) på disk.
- **Persistent upload-kö** som överlever omstart/krasch. En sparning skrivs
  **först lokalt + köas** → kan aldrig tappas.
- **Reconnect-sync:** kön töms när nätet är tillbaka; **versions-konflikt**
  (server-versionen har gått förbi base-versionen) ytläggs — **aldrig tyst
  överskrivning**.
- **Synlig status** (helperns menyrad + i web-appen): *väntar (offline) / synkad /
  konflikt*. Synligheten är hela poängen — motsatsen till KATS‑HIIT:s osynliga fel.
- **Browser-oberoende:** browsern kan stängas/reloadas; helpern fortsätter synka.
  (Inverterat beroende: helpern är auktoriteten, browsern en klient.)

### 2. Auth: **OIDC mot byråns egen IdP** (BYO-IdP, ADR 0009) — aldrig Keycloak-bunden

AVA är en **OIDC relying party och kör aldrig egen IdP** (ADR 0009). Byrån
kopplar sin **egen** IdP (Microsoft 365/Entra, Google Workspace, Okta …) och
`oauth2-proxy` federerar mot den via standard-discovery
(`.well-known/openid-configuration`, jfr `docker-compose.oidc-byoidp.yml`).
**Keycloak är bara e2e-/dev-fixturen** (`docker-compose.oidc.yml`), aldrig en
del av kund-stacken. Helpern måste därför auktorisera mot **vilken OIDC-IdP som
helst via discovery** — inte mot Keycloak specifikt.

- **Parnings-flöde — loopback-PKCE primärt (RFC 8252), device-code som fallback
  (RFC 8628):** helpern paras **en gång** genom att öppna systembrowsern mot
  byråns IdP och ta emot redirect på `http://127.0.0.1:<port>/callback` (PKCE).
  Loopback-PKCE stöds av **alla** OIDC-IdP:er och är vad native-CLI:er
  (`gh`/`az`/`gcloud`) använder; device-code (visa en kod) är fallback för
  headless-installationer eller IdP:er utan loopback. Helpern får **egna
  access-/refresh-tokens** och förnyar dem autonomt. Token lagras i
  **OS-keychain** (jfr ADR 0006).
- **Server-Bearer-väg:** servern validerar IdP:ns **JWT mot dess JWKS** (samma
  issuer `oauth2-proxy` redan litar på, hämtad via OIDC-discovery) — inget
  Keycloak-beroende. Idag bara oauth2-proxy-cookie (ADR 0009); Bearer-vägen
  **delas med Office-add-insen** (ADR 0013, samma tunn-klient-behov).
- Token är **centralt återkallbar** i byråns IdP ("Avregistrera enhet") och
  scopad till användarens dokument — inte hela sessionen.

### 3. Web-appen delegerar dokument-bytes till helpern via **localhost**

`localhost` fungerar **offline** (samma maskin). Web-appen använder helpern som
content-backend via den befintliga **`IContentStore`-sömmen** (jfr `StaticContentStore`/
`GitContentStore`) — en ny `HelperContentStore`:
- Läs/spara dokument-bytes → via helpern (offline-ok, durabelt, köat).
- **Saknas helpern** → web-appen faller tillbaka på sin egen cache + servern
  (dagens beteende, ADR 0016). Ingen utan helpern blir sämre ställd.
- **Ett** lokalt dokument-lager → ingen divergens. Både Word/PDF Gear och web-
  appen redigerar samma lokala sanning. Koherens mot servern via content-
  adressering (ADR 0023, ny version = ny hash = ny nyckel) + `change_log`
  (ADR 0017). Helpern nudgar web-appen ("dok X uppdaterat") → omedelbar reconcile.

### 4. Cache-policy (förfinar ADR 0022)

ADR 0022 satte working-set:en (mina/senaste/bevakade ärenden, metadata, blobbar
*on-demand*, budget-LRU). Detta beslut förfinar den:

- **a. "Öppna ärende" == ladda hem ALLT som rör ärendet i cachen** (eager, inte
  bara metadata): ärendet + dess barn (`timeEntries`, `expenses`, `serviceNotes`,
  `invoices`, `paymentPlans`, `matterContacts`) **OCH dokument-byte:sen** (via
  helpern). Skillnad mot ADR 0022 där blobbar hämtades on-demand → nu eager vid
  ärende-öppning, så **hela ärendet är offline-användbart**.
- **b. Hela kontaktlistan ligger ALLTID komplett + uppdaterad i cachen.**
  **Jävskontroll** måste söka över *alla* byråns kontakter, inte bara working-
  set:ens — annars kan en jäv missas. `contacts` läggs därför till "alltid-cachat"
  (utöver `users`/`organization`/`offices`/preferenser i ADR 0022) och hålls
  komplett via full delta-sync.
- **c. Dokumentsök är kapabilitets-tierad** (ADR 0027): **offline → sök i cachen**
  (lokalt index över cachade dokument); **online → sök på servern** (fullt index
  över *alla* dokument). Att resultaten är smalare offline (bara cachat) **ytläggs**
  i UI:t ("offline — söker bara i cachade dokument").
- **d. Vräkning: poster som legat OANVÄNDA i 30 dagar (konfigurerbart) vräks ur
  cachen** (last-use-TTL). **Undantag som aldrig vräks:** alltid-cachat (kontakter,
  users, organization, offices, preferenser) och **poster med väntande upload**
  (vräks aldrig förrän de synkats — annars vore en offline-ändring "borta").
  Kompletterar ADR 0022:s storleksbudget-LRU med en tids-baserad gräns.

## Konsekvenser

- **Offline funkar end-to-end:** öppna (cachat ärende), ändra, spara (durabelt
  lokalt + köat), och se att inget är borta. Synk + konfliktlösning vid reconnect.
- **Autonomt:** browsern oberoende → ingen KATS‑HIIT-fragilitet.
- **Ingen divergens:** ett lokalt dokument-lager (helperns), web-appen delegerar.
- **Helpern blir en riktig sync-motor** (durabelt lager + persistent kö + selective
  per-ärende-prefetch + konflikthantering + OIDC-auth mot byråns IdP). Kostnaden delas
  med Office-add-insen (ADR 0013) och bär dem.
- **Ingen IdP-låsning:** auth går via byråns egen IdP (BYO-IdP, ADR 0009) genom
  OIDC-discovery — Microsoft 365/Entra, Google, Okta … Keycloak är bara dev-/e2e-
  fixturen. Loopback-PKCE fungerar mot alla OIDC-IdP:er.
- **Tvådelad sök:** offline-resultat ⊆ online-resultat (bara cachat). Måste vara
  tydligt i UI:t, annars upplevs offline-sök som "saknar dokument".
- **Eviction-effekt:** ett ärende som inte rörts på 30 dagar vräks → ej tillgängligt
  offline tills det öppnas igen (online). Konfigurerbart per byrå/enhet.
- **Alltid-kompletta kontakter:** kontakter är små/text → billigt att hålla helt;
  garanterar korrekt jävskontroll offline.
- **Säkerhet:** device-token på disk (keychain), scopad, centralt återkallbar;
  refresh > statisk PAT. Browser↔helper över loopback-HTTPS (ADR 0006).

## Genomförande (en PR per steg)

1. **Server-Bearer-auth-väg** (validera IdP-JWT mot JWKS via OIDC-discovery på
   dokument-endpoints, IdP-agnostiskt) — delad med add-insen (ADR 0013).
2. **Helper loopback-PKCE-paring** (device-code-fallback) mot byråns IdP via
   OIDC-discovery + keychain-token + auto-refresh.
3. **Helper durabelt content-lager + persistent upload-kö + reconnect-sync +
   versions-konflikt.**
4. **Per-ärende eager prefetch** ("öppna ärende" → ärendets metadata + blobbar);
   **alltid-sync av hela kontaktlistan.**
5. **`HelperContentStore`** (IContentStore) i web-appen + helper-närvaro-detektion
   (kapabilitet, ADR 0027) + fallback till egen cache/server.
6. **Offline-/online-sök-gren** (cache-index offline; server online) + UI-upplysning.
7. **30-dagars-last-use-vräkning** (konfigurerbar), exkl. alltid-cachat + väntande
   uploads.
8. **Synlig status** (helper-meny + web-app-banner): väntar/synkad/konflikt.

## Öppna frågor

- **Selective-sync-omfång utöver öppet ärende:** ska "mina ärenden" (ADR 0022)
  också eager-prefetcha blobbar, eller bara det aktivt öppnade ärendet? (Påverkar
  hur mycket disk helpern håller.)
- **Konfliktlösnings-UX:** behåll-bägge / välj-version / merge — detaljeras när
  versions-historiken för dokument är på plats.

## Relaterat

ADR 0022, 0016, 0017, 0023, 0013, 0009, 0006, 0027. Föranlett av offline-kravet +
KATS‑HIIT-erfarenheten (browser-koordinerad helper = ömtålig + osynliga fel).
