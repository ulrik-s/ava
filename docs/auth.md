# AVA — Autentisering (self-hosted)

Denna fil beskriver hur autentisering fungerar för AVA:s **self-hosted**-läge
(docker på Linux). Demo-läget på GitHub Pages är read-only och har ingen auth.

> **Beslutad riktning ([ADR 0009](./adr/0009-oidc-login-via-servern.md), epic
> [#221](https://github.com/ulrik-s/ava/issues/221)):** människo-login flyttar
> till **OIDC** — AVA blir en *relying party* (bring-your-own-IdP: Entra
> ID/Google/BankID-broker), enforce:at av `oauth2-proxy` i nginx-fronten, med
> användar-allowlist i firma.git. Designmålet "ingen extern IdP" nedan revideras
> då till **delegerad identitet (ej data)** — data lämnar aldrig firma.git — med
> self-hosted IdP (Authelia) som tillval. Dokumentet nedan beskriver den
> **nuvarande** htpasswd/PAT-modellen tills epiken landar; maskin-/CLI-klienter
> (server-runtime, `git clone`) behåller PAT/deploy-key även efteråt.

## OIDC-läge (#222, opt-in) — oauth2-proxy

OIDC-inloggning aktiveras med en compose-overlay (default-stacken är oförändrad):

```bash
docker compose -f tooling/docker/docker-compose.yml \
               -f tooling/docker/docker-compose.oidc.yml up -d --build
```

**Komponenter:**

- `nginx-oidc.conf` — nginx gat:ar `/git/` (och `/api/` i
  `nginx-selfhosted.conf` / Caddyfile) med `auth_request` → `oauth2-proxy`;
  utan session blir det en naken 401. **App-skalet gat:as inte** (#1245): det är
  statiska filer utan data, och klienten skickar själv en utloggad användare
  till `/oauth2/start`. Eftersom appen och `/git/` är samma origin följer
  oauth2-proxy-cookien automatiskt med `fetch`.
- `oauth2-proxy` — OIDC relying party. Pekas mot byråns IdP via
  `OAUTH2_PROXY_OIDC_ISSUER_URL` + `CLIENT_ID`/`CLIENT_SECRET`; cookie-secret
  ur secrets-valvet (#79). `keycloak`-tjänsten i overlayen är **endast dev/test**
  (realm `ava` med test-användare admin/lawyer/outsider, importeras vid start)
  — ta bort den i drift och peka issuer mot byråns IdP (Entra ID/Google/BankID-broker).
  Dual-URL i docker: publik issuer (det browsern når) + intern backchannel
  (token/jwks/userinfo via `keycloak:8080`) löses med `SKIP_OIDC_DISCOVERY` +
  explicita `REDEEM_URL`/`OIDC_JWKS_URL`/`PROFILE_URL`.
- **Klient-bryggan:** appen hämtar inloggad email från `/oauth2/userinfo`
  (`src/lib/client/auth/session-probe.ts`) och auktoriserar mot
  användar-allowlisten i firma.git via `OidcAuthProvider` (#223). Okänd email
  nekas (autentisering ≠ auktorisering).

### Sessionen i klienten och IdP-avbrott (#1245, #1351, ADR 0018)

Vid varje start frågar klienten `/oauth2/userinfo`
(`src/lib/client/auth/session-probe.ts`, högst 3 s — starten hänger aldrig på
proxyn). Bara oauth2-proxys egna svar räknas som besked; allt annat är "vet
inte" och då avgör offline-graceperioden (`session-gate.ts`):

| Svar på `/oauth2/userinfo` | Utfall | Inom grace (7 dygn) | Utan giltig grace |
|---|---|---|---|
| 200 + JSON med email, samma identitet | inloggad | startar, noterar `sessionVerifiedAt` | (samma) |
| 200 + JSON med email, ny/annan identitet | inloggad | binder principalen mot användarlistan | (samma) |
| 401 | utloggad (bekräftat) | startar lokalt + bannern **Logga in igen** | till `/oauth2/start?rd=<sidan>` |
| nätverksfel, inget svar inom 3 s, 5xx | nås inte | startar lokalt + bannern | besked: anslut till nätet |
| omdirigering (3xx/`opaqueredirect`), annan 4xx | nås inte | startar lokalt + bannern | besked: anslut till nätet |
| 200 med HTML/annan typ (captive portal), JSON utan email | nås inte | startar lokalt + bannern | besked: anslut till nätet |
| 404 (ingen oauth2-proxy, basic-auth-drift) | finns inte | som förut | som förut |

Inom grace skickas ingen hårt vidare till IdP:n: den kan vara nere (då
hamnade användaren på en felsida), och ett formulär mitt i skrivandet ska inte
försvinna. Bannern låter användaren välja när; en lyckad synk tar bort den.
Ingen bunden identitet på enheten → alltid till inloggningen.

Vid synk, när servern svarar 401, bär svaret serverns skäl
(`data.authFailure`, `src/lib/shared/auth-failure.ts`):

| Skäl | Klienten visar |
|---|---|
| `account-inactive` (giltig identitet, inte aktiv i byråns lista) | kontot är spärrat — osynkade ändringar ligger kvar på enheten men sparas inte (karantän) |
| `token-expired` (korrekt signerad token som gått ut, `verified`-läget) | "Logga in igen" |
| `no-identity` / naken 401 från proxyn | proxyn frågas: utloggad → "Logga in igen"; inloggad som någon annan än den bundna → sidan laddas om (#1404); inloggad (men servern vägrar) → "Logga in igen" (token duger inte); nås inte → inget särskilt |

**Identitetsbyte i en annan flik (#1404).** Loggar någon annan in i samma
webbläsare byts proxyns cookie, och servern vägrar den bundna användarens
köposter (#1347). Svarar proxyn då med en annan e-post än den bundna laddas
sidan om (inte "Logga in igen"): grinden binder den nya användaren och rensar
den förras lokala data som vid ett identitetsbyte vid start. Den förras
osynkade ändringar ligger kvar i hennes egna databaser.

Kön töms aldrig tyst, och ingen omdirigering sker utan att användaren klickar.

**Sessionen förnyas** (`OAUTH2_PROXY_COOKIE_REFRESH`, #1351). ID-token från
Entra gäller en timme. Utan förnyelse dog proxyns session efter en timme, och
i `verified`-läget fick servern en utgången token (401 med beskedet "kontot
spärrat"). Proxyn förnyar med refresh-token vid första anropet efter
`COOKIE_REFRESH` — innan den validerar — så den token servern får har alltid
minst 30 minuter kvar. Misslyckas förnyelsen (IdP:n nere) behålls sessionen
tills token gått ut; därefter ger proxyn 401 och klienten visar bannern.

| Stack | `COOKIE_REFRESH` | `COOKIE_EXPIRE` | scope |
|---|---|---|---|
| produktion, BYO-IdP (Entra) | `30m` (< ID-tokenets 60 min) | `168h` (= offline-grace) | `openid email profile offline_access` |
| Keycloak-riggar (realm `accessTokenLifespan` 300 s) | `1m` | `168h` | (provider-default) |

Entra ger refresh-token bara när `offline_access` finns i scope. Proxyn
vägrar starta om `COOKIE_REFRESH` >= `COOKIE_EXPIRE`.
`test/unit/tooling/session-refresh.test.ts` fäller en stack som saknar
förnyelse.

Servern verifierar tokens med `algorithms: ["RS256"]` och `clockTolerance:
60 s` (`src/lib/server/http/bearer-claims.ts`).

**När IdP:n (t.ex. Entra) är nere:**

- Den som redan har en giltig proxysession märker inget: oauth2-proxy
  validerar sin egen cookie utan IdP:n (förnyelsen misslyckas tyst tills
  token gått ut).
- Den vars session gått ut kan inte logga in på nytt förrän IdP:n är uppe
  igen, men **appen startar ändå** — skalet kommer från service workern eller
  servern utan inloggning — under den cachade identiteten inom grace-tiden,
  med bannern "Logga in igen". Ändringarna köas och synkas efter nästa
  inloggning.
- Servern tar aldrig emot data utan giltig session: `/api` och `/git` gat:as
  fortfarande av proxyn, och principalen omvalideras vid varje anrop.
- `test/e2e/oidc/oidc-idp-down.spec.ts` (i `bun run e2e:oidc`) prövar det mot
  den riktiga stacken: ingen omdirigering, ingen loop, banner.

Den cachade identiteten (`principalId`, e-post, `sessionVerifiedAt` i
`ava.firma`) är ingen hemlighet: den ger ingen åtkomst till servern, bara till
det som redan finns lokalt på enheten. Sessionshemligheten är proxyns
HttpOnly-cookie. Refresh-token (`offline_access`) hålls av oauth2-proxy i
dess krypterade cookie — aldrig i klienten (Option B i ADR 0018, en klient-
hållen refresh-token, är inte byggd).

### Lokal data, byte av användare och utloggning (#1347, advokatsekretess)

**Lokala databaser per användare och byrå.** Allt klienten sparar om byråns
data i webbläsaren ligger i IndexedDB-databaser vars namn bär byråns och
användarens id (`<namn>@<byrå>:<användare>`,
`src/lib/client/backend/local-data/local-namespace.ts`). Inventariet
(`LOCAL_DB`):

| Databas | Innehåll | Vid utloggning |
|---|---|---|
| `ava-local-store` | cachen av byråns data (hela snapshotet) | raderas |
| `ava-doc-text` | dokumenttext för den lokala sökningen | raderas |
| `ava-doc-content` | dokumentbytes + dokument som väntar på uppladdning | läs-cachen raderas; väntande uppladdningar behålls |
| `ava-generated-docs` | räddningskopior av lokalt genererade dokument | behålls bara om uppladdningar väntar |
| `ava-mutation-queue` | osynkade ändringar (rader + procedur-anrop) | behålls om den inte är tom |
| `ava-rejected-changes` | ändringar servern avvisade, som väntar på ställningstagande | behålls om den inte är tom |
| `ava-deferred-faktura-docs` | fakturadokument som väntar på fakturanummer | behålls om den inte är tom |

Övrigt i webbläsaren: `ava.firma` (identiteten glöms vid utloggning — tier,
byrå och inställningar ligger kvar), `ava.calendar.selectedUsers` och
`ava.outlookToken` (tas bort), hela `sessionStorage` (Microsoft-inloggningens
tokens; töms), service workerns `ava-app-*`-cache (bara appens skal, aldrig
byråns data eller dokument). Demon (GitHub Pages) använder de gamla,
gemensamma namnen: påhittad, publik data som demoanvändarna medvetet delar.

**Beslutet om utloggning.** Webbläsarprofilen är gemensam för alla som
använder datorn — det som ligger kvar efter en utloggning kan nästa person
läsa (utvecklarverktygen räcker), oavsett vilket namn databasen har. Därför
raderas allt som bara är en kopia av serverns data. Det enda som ligger kvar
är användarens eget **osynkade arbete**, i hennes egna databaser, tills hon
loggar in igen som samma användare (då synkas det). Att radera det vore att
kasta advokatens arbete; att behålla det är en medveten avvägning — och
dialogen säger det: *"Du har N osynkade ändringar"* → **Synka** / **Logga ut
ändå** (ändringarna sparas till nästa inloggning som samma användare) /
**Avbryt**. Finns inget osynkat raderas allt.

**Utloggningen** (`sign-out.ts`): synka → fråga → rensa lokal data → glöm
identiteten → andra flikar laddar om (`ava-session`-kanalen) →
`/oauth2/sign_out?rd=…`. oauth2-proxys `sign_out` tar bara bort proxyns egen
HttpOnly-cookie (den går inte att ta bort från JavaScript); IdP:ns session
(Entra) lever kvar, och nästa inloggning i samma webbläsare går då tyst
igenom som samma person. För RP-initierad utloggning hos IdP:n:

```
# server-first (ava-server.env): IdP:ns end_session_endpoint, med retur till landningssidan
AVA_OIDC_END_SESSION_URL=https://login.microsoftonline.com/<tenant>/oauth2/v2.0/logout?post_logout_redirect_uri=https%3A%2F%2F<din-host>%2Flogin%2F%3FsignedOut%3D1
# oauth2-proxy: rd följs bara till vitlistade domäner
OAUTH2_PROXY_WHITELIST_DOMAINS=login.microsoftonline.com
```

`post_logout_redirect_uri` måste också vara registrerad som en av
app-registreringens redirect-URI:er i Entra. Utan konfigurationen landar
utloggningen på `/login/?signedOut=1` ("Du är utloggad"). Utloggning offline:
allt lokalt görs ändå, och nästa start online går via `/oauth2/sign_out`
först (`ava.pendingSignOut`) — annars skulle cookien släppa in nästa person.

**Byte av användare.** Ser sessionsgrinden en annan identitet än den bundna
(`bind`) är den förra användarens session i webbläsaren slut: hennes lokala
data rensas som vid en utloggning (hennes osynkade arbete ligger kvar åt
henne). Bindningsfasen kör storen helt i minnet — inget sparas lokalt förrän
det är avgjort vem som loggar in — och sidan laddas om under den nya
användarens egna databaser.

**A:s kö spelas aldrig upp som B.** Köposter stämplas med användare och byrå
(`owner`). Klienten läser bara in den inloggades poster (en annan användares
spelas inte upp, kvitteras inte och tas inte bort), och servern (`sync.push`,
`sync.replay`) vägrar en post vars ägare inte är den inloggade (UNAUTHORIZED
— kön stannar, inget avvisas). Servern kör ändå alltid som `ctx.user`.

**Migrering från före #1347.** De gemensamma databaserna tillhör den användare
som var bunden när den nya koden kördes första gången (`principalId`, annars
e-postadressen om hon loggat ut med gammal kod); ägaren avgörs en gång och
sparas (`ava.localData.legacyOwner`). Bara hon tar över dem: kön och de
avvisade ändringarna flyttas post för post vid varje läsning (som #1346:
idempotent, kvitterade poster kommer inte tillbaka, de gamla databaserna
uppgraderas aldrig), övriga kopieras och raderas. En annan användare tar
aldrig över dem — för henne raderas bara deras cache-kopior.

**Textcachen** (`ava-doc-text`) glömmer texten för ett borttaget dokument vid
nästa synk (eller start) och hålls under 50 MB (räknat som UTF-16); den text
som använts längst sedan går först. Dokument i juristens aktiva ärenden räknas
som använda vid varje förladdning.

**Skarp drift (env, ur valvet):**

```
OAUTH2_PROXY_OIDC_ISSUER_URL=https://login.microsoftonline.com/<tenant>/v2.0
OAUTH2_PROXY_CLIENT_ID=<app-reg-client-id>
OAUTH2_PROXY_CLIENT_SECRET=<ur valvet #79>
OAUTH2_PROXY_COOKIE_SECRET=<32 byte, ur valvet>
OAUTH2_PROXY_REDIRECT_URL=https://<din-host>/oauth2/callback
```

**CLI/maskin (icke-browser):** behåller Basic-auth/PAT — sätt
`OAUTH2_PROXY_HTPASSWD_FILE=/auth-data/htpasswd` så oauth2-proxy accepterar
både OIDC-cookie och PAT på `/git/`. server-runtime (#81) använder PAT/deploy-key.

**Verifiering / regressionsbatteri:** `bun run e2e:oidc` startar stacken
(web + oauth2-proxy + Keycloak) och kör Playwright-batteriet
(`test/e2e/oidc/oidc-login.spec.ts`) som loggar in via Keycloaks RIKTIGA
login-formulär och verifierar hela token-dansen: redirect → login → callback →
session-cookie → `/oauth2/userinfo`, plus fel-lösenord, utloggning och
skydd-utan-session. Körs i CI (jobbet **E2E (OIDC login)**). OBS: lokalt på
Mac kan Docker Desktop ge flakiga browser→port-anslutningar; CI (linux) är
den deterministiska grinden (samma mönster som round-trip-e2e:n).

### Första-admin (bootstrap, #224 — BESLUTAT)

Hönan-och-ägget: en färsk firma.git har inga User-rader → ingen är allowlistad.
Rotförtroende = den som kör `docker compose up` (host shell-access).

**Kanonisk väg — host-shell-CLI:**

```bash
bun run bootstrap:admin --work-dir <firma.git-klon> --email du@byrå.se --org "Byrå AB" --commit
```

Skriver `.ava/users/<email>.json` (role ADMIN, deterministiskt uuidv5-id,
idempotent) + org + `.ava/meta.json`, committar i firma.git. Därefter loggar du
in via OIDC och resolvas som ADMIN (allowlisten = User-raderna). Se runbooken
[`self-hosted-entra.md`](./self-hosted-entra.md) steg 3.

> **Beslut #224:** vi bygger INTE ett engångs-token-via-HTTP-bootstrap för
> standard-self-hosted (alla sådana deploys har shell → CLI:n räcker; undviker
> en admin-mintande endpoint). Auktorisering är **email-only** — `oidcSubject`-
> bindning är uppskjuten (relevant först vid multi-IdP; kräver att oauth2-proxy
> exponerar sub/iss). Se [ADR 0009](./adr/0009-oidc-login-via-servern.md).

**Valfritt (ej default-väg):** auth-tjänsten (profil `invite-server`) har ett
`POST /auth/claim-admin` (engångs `BOOT_SECRET` i loggen) som låter en inloggad
OIDC-användare claima admin utan shell. Kvar för en eventuell *managed* deploy
utan shell-access men ingår inte i standard-flödet. Pure-logiken
(`claimAdminDecision`) är enhetstestad i `test/unit/lib/auth-server-core.test.ts`.

## Designmål

- **Tunn server**: ingen custom auth-tjänst, inga long-running processer
- **Svensk data-suveränitet**: ingen extern IdP, ingen tredje-parts proxy
- **Browser-kompatibel**: webb-klienten (isomorphic-git) måste kunna pusha
- **Identifierbar**: varje commit ska gå att knyta till en specifik advokat

## Vad som faktiskt körs

Server-sidan består av (i default-läget):

1. **nginx** (1.27-alpine, vanilla — ingen lua, ingen custom modul)
2. **`git-http-backend`** (binär ur git-paketet)
3. **`fcgiwrap`** (CGI-bridge)
4. **`sshd`** (för git+ssh-access)
5. **`htpasswd`** + **`openssl`** (binärer från `apache2-utils`)
6. **15 rader bash i entrypoint**: bootstrappar admin-PAT vid första uppstart

Ingen custom Node-tjänst körs i default-stacken.

## Auth-grinden (nginx)

`tooling/docker/nginx.conf` sätter `auth_basic` på `/git/`:

```nginx
location ~ ^/git(/.*)?$ {
  auth_basic "AVA";
  auth_basic_user_file /auth-data/htpasswd;
  # ...fastcgi_pass till git-http-backend...
}
```

`/auth-data/htpasswd` mountas via en docker-volym (`auth_data`) som är
skrivbar av web-containerns entrypoint + admin (via `docker exec`).

## Bootstrap (första uppstart)

`tooling/docker/web/entrypoint.sh` kör:

```bash
if [ ! -s /auth-data/htpasswd ]; then
  ADMIN_PAT=$(openssl rand -base64 32 | tr -d '=+/' | head -c 40)
  htpasswd -bBc /auth-data/htpasswd admin "$ADMIN_PAT"
  echo "Admin-token: $ADMIN_PAT"   # printas EN GÅNG i loggen
fi
```

Admin kör då:

```bash
docker compose -f tooling/docker/docker-compose.yml up -d
docker compose logs web | grep "Admin-token"
```

Kopierar token:n och öppnar `http://<server>/ava/setup` → klistrar in.
Token:n persisteras i browserns `localStorage` (`ava.firma.token`) och
skickas som Basic-auth-password mot `/git/`.

## Lägg till fler användare

```bash
tooling/scripts/add-user.sh anna@firma.se
# → printar email + ny slumpad PAT
```

Scriptet är ~15 rader bash som kör `docker exec ava-web-1 htpasswd -bB ...`.

Admin skickar PAT + email till den nya användaren **via säker kanal**
(Signal, SMS, i person — INTE okrypterad e-post). Användaren öppnar
`/setup` i sin browser och klistrar in.

## Rotera PAT

```bash
tooling/scripts/add-user.sh anna@firma.se          # ny slumpad PAT
# eller
tooling/scripts/add-user.sh anna@firma.se <ny-pat> # admin-vald PAT
```

Existerande hash skrivs över. Anna måste klistra in den nya i `/setup`
nästa gång hon kör.

## Ta bort användare

```bash
docker exec ava-web-1 htpasswd -D /auth-data/htpasswd anna@firma.se
```

Befintliga browser-sessioner får 401 vid nästa pull/push och tvingas
till `/setup`.

## Commit-attribution

Network-auth (htpasswd) verifierar bara att klienten har en giltig PAT —
inte vem den klienten "är". Identitet binds till commits via SSH-signering:

1. Browser genererar ett Ed25519-keypar vid första körningen (persisteras i `IndexedDB`)
2. Public key registreras på user-raden (`.ava/users/<email>.json`, fältet `publicKeys`)
3. Varje commit signeras med private key i SSH-format (`gpgsig`-fältet i commit-objektet)
4. En git pre-receive hook (manuellt installerad om man vill enforce) kan verifiera att signeringsnyckeln matchar en av de registrerade nycklarna för den claimade authorn

I default-läget signeras commits men signaturen verifieras inte server-side.
Det är opt-in via en hook i `firma.git/hooks/pre-receive`.

## Säkerhetsbudget

| Hot | Skydd |
|---|---|
| Anonym läsning av git-data | `auth_basic` → 401 |
| Anonym push | Samma — `auth_basic` skyddar `git-receive-pack` |
| Spoofad commit-author | SSH-signatur verifieras (om hook installerad) |
| Stulen PAT | Rotera via `add-user.sh` |
| Network sniffing | Sätt upp HTTPS framför docker (Caddy/nginx-reverse-proxy med Let's Encrypt). Out-of-scope för dessa docs. |

## Vad om jag vill ha invite-flöde via UI istället för SSH?

Det finns en **valbar** docker-compose profil `invite-server` som lägger
till en tunn Node-tjänst (`tooling/docker/auth-server/`) som utfärdar
PATs via bootstrap-secret + invite-tokens. Default OFF.

```bash
docker compose -f tooling/docker/docker-compose.yml --profile invite-server up -d
```

Då exponeras `/auth/`-endpoints i nginx och `/setup`-sidan visar avancerade
flöden bredvid "klistra in PAT". Se `tooling/docker/auth-server/server.mjs`.

Men detta är **inte** rekommenderat för USP:n "din data, du bestämmer" —
varje server-process är drift för kunden. Default-läget med htpasswd +
admin-SSH har inga sådana processer.

## Vad om jag vill ha O365/BankID?

Inte default. Båda kräver extern IdP-tjänst eller server-side integration
som bryter "din data, du bestämmer"-modellen. När en kund explicit
efterfrågar det kan en valbar profil tillkomma — t.ex. egen BankID
RP-cert + en liten Node-tjänst som signerar PATs efter BankID-auth.
Implementerat per-kund, inte standard.
