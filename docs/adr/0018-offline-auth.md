# ADR 0018 — Offline-auth: OIDC `offline_access`-refresh-token (primär) + cachad session med grace (fallback)

- **Status:** Accepterad
- **Datum:** 2026-06-17
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** offline-first-klient, auth, sync/reconcile, server-runtime, säkerhet
- **Issue:** [#405](https://github.com/ulrik-s/ava/issues/405)
- **Bygger på:** [ADR 0016](0016-server-first-med-offline-first-klient.md) (server-first +
  offline-first klient — beslut 2 "offline-auth" konkretiseras här),
  [ADR 0009](0009-oidc-login-via-servern.md) (OIDC relying party, BYO-IdP, oauth2-proxy).
- **Knyter an till:** [ADR 0017](0017-sync-reconcile-protokoll.md) (reconcile/replay —
  offline-mutationer attribueras och verifieras vid sync),
  [ADR 0013](0013-office-add-in-arkitektur.md) (tunn server äger db + tRPC-over-HTTP),
  [ADR 0003](0003-nyckelstrategi-app-genererad-uuidv7.md) (klient-genererat mutations-id).

## Kontext

ADR 0016 gjorde servern auktoritativ och klienten offline-first: en jurist ska
kunna **arbeta** offline (föra tid, skriva utkast, läsa ärenden) och synka rent
vid återanslutning. ADR 0009 fastslog att AVA är en OIDC *relying party* (aldrig
egen IdP) och att login enforce:as av `oauth2-proxy` framför nginx-fronten.

Men **OIDC kräver per definition uppkoppling för login** — proxyn validerar en
sessions-cookie mot IdP:n. Det krockar med offline-kravet: en jurist på en hel
flygning, i ett rättssalskällare utan täckning, eller på tåget får inte låsas ut
ur sin egen lokala arbetskopia bara för att uppkopplingen tog slut. Samtidigt får
offline-luckan inte bli ett säkerhetshål: en avregistrerad användare ska inte
kunna fortsätta arbeta hur länge som helst, och de hemligheter som möjliggör
offline-arbetet får inte ligga oskyddade på enheten.

Frågan ADR 0016 sköt upp till denna ADR: **hur attesteras en principal offline,
hur länge, och hur verifieras offline-arbetet vid återanslutning** — utan att
bygga egen auth-kod (ADR 0009:s "tunn server"-tvång gäller) och utan att tappa
arbete.

Två observationer ramar in valet:

1. **Two skilda problem.** *Authentication offline* ("vem är du, och får du
   arbeta just nu?") är skilt från *integritet/non-repudiation* ("kan servern
   bevisa att den här offline-mutationen kom från enhet X / användare Y?"). Det
   första är ett auth-/grace-problem; det andra ett signerings-problem. De kan
   lösas i olika lager och behöver inte lösas samtidigt.
2. **Befintligt material.** AVA har redan Ed25519-nyckelhantering för
   commit-signering (`src/lib/client/keys/`), och `OidcAuthProvider`
   (`src/lib/server/auth/principal.ts`) stödjer redan sub/iss-bindning. Det gör
   ett framtida signeringslager inkrementellt snarare än grönfält.

## Alternativ

### Option A — Cachad OIDC-session + glidande grace

Klienten cachar OIDC-identiteten vid senaste login och arbetar offline under den i
en konfigurerbar grace (default ~7 dagar). Offline-mutationer köas, attribueras
till den cachade principalen och accepteras **preliminärt**; vid reconnect
omvaliderar oauth2-proxy/IdP sessionen och servern stämplar verifierad principal
(eller **karantänsätter** om identiteten återkallats).

- **För:** enklast; passar oauth2-proxy direkt; ingen klient-krypto; bra UX;
  minimal IdP-konfiguration.
- **Mot:** preliminärt förtroende → en återkallad användares offline-arbete kan
  behöva avvisas (riskerar förlorat arbete); den cachade sessionen är en
  bearer-liknande hemlighet (exponeringsfönster = grace-längden); ingen
  kryptografisk non-repudiation.

### Option B — OIDC `offline_access`-refresh-token + korta access-tokens (VALD: primär)

Klienten begär scope `offline_access` vid login → en långlivad **refresh-token**
lagras krypterat på enheten. Korta access-tokens förnyas tyst medan man är online.
Offline litar klienten på senaste tokens claims tills refresh-tokenens max-ålder;
vid reconnect förnyas den (eller tvingar re-login om IdP:n återkallat den).

- **För:** standard-OIDC — **IdP:n äger grace + återkallning** (ren säkerhets-
  story, ingen egen-byggd token-livscykel, håller "tunn server"); återkallning
  biter vid reconnect (IdP nekar refresh); kort online-fönster för access-token.
- **Mot:** beror på att byråns BYO-IdP **stödjer och konfigurerar**
  `offline_access` (alla gör inte det); refresh-token är en högvärdig hemlighet
  som kräver säker lagring; attestering är **sessions-nivå**, inte per-mutation-
  signerad.

### Option C — Enhetsnyckelpar + signerade offline-mutationer (UPPSKJUTEN)

Ett **integritets-lager ovanpå A/B**, inte fristående auth. Enheten enrollar ett
nyckelpar; varje offline-mutation signeras; servern verifierar signaturen mot den
registrerade nyckeln vid sync. Session/grace styr fortfarande *auktorisationen* —
signaturen styr *integritet/non-repudiation*.

- **För:** starkast — bevisbart från enhet X / användare Y även om sessionen
  hunnit löpa ut; **återanvänder befintlig Ed25519-commit-signering**
  (`src/lib/client/keys/sign-commit.ts`, `ed25519-keypair.ts`, helper-notarisering)
  → inkrementellt; per-enhet-återkallning.
- **Mot:** mest komplex (enroll/rotation/återkallning/borttappad-enhet-recovery);
  svarar inte ensam på "får du arbeta just nu?"; tyngre enrollment-UX.

### Option D — Read-only offline; alla skrivningar online-only (FÖRKASTAD)

Faller ihop med online-only-handlingskön (#407): offline = bara läsning.

- **För:** enklaste säkerheten; inget offline-förtroende-problem; ingen signering.
- **Mot:** **urholkar offline-first-USP:n** (juristen i rättssalskällaren kan inte
  föra tid eller skriva anteckningar); motsäger ADR 0016 rakt av.

## Beslut

**Option B är den primära mekanismen, Option A är fallback, Option C är uppskjuten,
Option D förkastas.**

1. **Primärt (B): OIDC `offline_access` + korta access-tokens.** Klienten begär
   `offline_access` vid login. Refresh-tokenen lagras **krypterad i vila** på
   enheten; korta access-tokens förnyas tyst online. Offline litar klienten på
   senaste verifierade tokens claims tills refresh-tokenens max-ålder. IdP:n äger
   grace-fönstret och återkallningen — AVA bygger ingen egen token-livscykel.
2. **Fallback (A): cachad session + grace** för IdP:er som **inte** utfärdar
   `offline_access`. Klienten cachar den verifierade OIDC-identiteten vid senaste
   login och arbetar offline under en **konfigurerbar grace (default ~7 dagar)**.
   Vald automatiskt utifrån vad IdP:n stödjer (discovery / faktiskt utfärdade
   scopes) — inte en separat produkt-tier.
3. **Uppskjutet (C): enhets-signerade mutationer** dokumenteras som ett additivt
   integritets-lager ovanpå B/A, att bygga när non-repudiation/per-enhet-
   återkallning faktiskt krävs (affärsbyrå-/ACL-spåret). Det är **inte** ett
   alternativ till B/A utan ett lager över. Återanvänder Ed25519-signeringen.
4. **Förkastat (D): read-only offline** — oförenligt med offline-first-kravet
   (ADR 0016). Den *enda* delen som ändå köas online-only är externa sido-effekter
   (mail, Fortnox, webhooks) — det är ADR 0016 beslut 3 / #407, inte auth.

### Säkerhets-vredet (gäller både B och A)

Oavsett mekanism pinnas följande:

- **Grace-längd:** default ~7 dagar (täcker en realistisk offline-period utan att
  hålla ett återkallat förtroende vid liv i veckor). Konfigurerbart per byrå; i B
  styrs det ytterst av IdP:ns refresh-token-max-ålder.
- **Krypterad i vila:** refresh-token (B) respektive cachad session (A) lagras
  **aldrig i klartext**. Föredragen lagring: OS-keychain via helpern (ADR 0006),
  annars icke-extraherbar WebCrypto-nyckel. Aldrig i `localStorage` i klartext.
- **Kort access-token-livslängd:** online-fönstret där en stulen access-token
  duger hålls kort (minuter) — refresh sköter förnyelsen.
- **Karantän, inte tyst accept:** en offline-mutation från en session som
  **återkallats medan enheten var offline** får **inte** tyst accepteras vid sync.
  Den karantänsätts (avvisas som en reconcile-konflikt, ADR 0017 surface-klass)
  och ytläggs — hellre synligt avvisad än tyst insläppt. Redan-accepterat
  offline-arbete före återkallningen behålls; allt efter karantänsätts.

### Hur det möter reconcile (ADR 0017)

Offline-mutationer bär redan klient-genererat UUIDv7-id (ADR 0003) och attribueras
till den cachade/token-burna principalen. Vid replay (ADR 0017 steg 2) verifierar
servern principalen mot sitt *aktuella* tillstånd: giltig → accepteras och stämplas
med verifierad principal; återkallad → karantän (surface-konflikt). Detta kräver
**ingen** ändring i reconcile-sekvensen — bara att principal-verifieringen körs som
en del av server-validering per mutation.

## Konsekvenser

**Positivt**
- Standard-OIDC-väg (B) → ingen egen-byggd token-livscykel; IdP:n äger
  återkallning och grace. Håller ADR 0009:s "tunn server"-tvång.
- Fallback (A) gör att byråer vars IdP saknar `offline_access` ändå får
  offline-arbete — ingen byrå låses ute.
- Karantän-regeln gör säkerhetsbeteendet explicit och förutsägbart: återkallat
  förtroende kan aldrig tyst smyga in arbete.
- C uppskjuten men förberedd (Ed25519 finns) → non-repudiation kan adderas utan
  omarkitektur när ACL-spåret kräver det.
- Demon (GH Pages, ingen server) berörs inte — den självdeklarerar principal
  (ingen ACL att skydda), precis som ADR 0009/0016 redan säger.

**Negativt / risker**
- **Två kodvägar** (B + A) under offline-auth → mer testyta. Mitigeras av att de
  delar samma nedströms-kontrakt (cachad verifierad principal + karantän-vid-sync);
  bara *källan* till förtroendet skiljer.
- Refresh-token/cachad session är högvärdiga hemligheter; säker lagring (keychain/
  WebCrypto) är ett krav, inte en optimering — fel här är en reell läcka.
- B:s funktion beror på BYO-IdP-konfiguration (`offline_access` påslaget, rimlig
  refresh-token-livslängd) — utanför AVA:s kontroll; onboarding-dok måste täcka det.
- A:s preliminära förtroende kan i värsta fall avvisa offline-arbete från en
  återkallad användare (accepterat: karantän > tyst accept).

## Öppna frågor

- Exakt grace-/refresh-token-livslängd per byrå-policy (default ~7 d) — mätas mot
  verkliga offline-mönster.
- Var den krypterade token-/session-lagringen bor i klient-koden + helper-API:t
  (keychain vs WebCrypto-fallback per plattform/webbläsare).
- Karantän-UX för det sällsynta återkallad-medan-offline-fallet (delar yta med
  ADR 0017:s surface-konflikt-UX, #416).
- Triggern för att bygga C (enhets-signering): vilken affärsbyrå-/ACL-milstolpe
  gör non-repudiation till ett hårt krav.
