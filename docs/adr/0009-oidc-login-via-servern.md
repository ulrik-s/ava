# ADR 0009 — OIDC-login via servern (relying party, ej IdP)

- **Status:** Accepterad
- **Datum:** 2026-06-11
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** self-hosted-tier:ns auth (web-fronten), onboarding, server-runtime (ADR 0005)
- **Issue:** [#221](https://github.com/ulrik-s/ava/issues/221) (epic)
- **Relaterat:** [ADR 0001](./0001-pluggbar-backend-bakom-idatastore.md) (ingen ACL i git-backenden — uppskjuten), [ADR 0005](./0005-server-som-git-peer.md) (tunn git-peer-server), [ADR 0008](./0008-secrets-valv-krypterad-fil.md) (secrets-valv), [#79](https://github.com/ulrik-s/ava/issues/79), [#81](https://github.com/ulrik-s/ava/issues/81)

## Kontext

Self-hosted-auth är idag nginx `auth_basic` + htpasswd (Basic-auth-header), med
en slumpad admin-PAT som bootstrappas vid första start. Det fungerar för git-
transporten men är svagt för människor: inga sessioner, ingen MFA, inget SSO,
lösenordshantering på byrån.

AVA:s self-hosted-stack har redan en **obligatorisk** server för git-tier:en —
`web`-containern (nginx + static-app + git-http-backend). Det är där auth redan
sker. (Den separata **server-runtime:n**, peer-loopen i ADR 0005/#81, är en
maskin-principal och är frivillig — människo-login hör inte hemma där.) Att
uppgradera auth i `web`-fronten adderar alltså **ingen** ny obligatorisk
komponent.

Tre USP-tvång styr beslutet:

1. **Tunn server** — bygga en egen authorization server (token-signering,
   nyckelrotation, consent, account recovery) är raka motsatsen.
2. **Ingen tredjeparts-infra för data** — byråns data får aldrig lämna firma.git.
3. **Svenska tjänster / advokatsekretess + GDPR** — identitet ska kunna vila på
   svensk eID (BankID) eller byråns egen tenant.

"OAuth" rymmer två oförenliga roller: **authorization server / IdP** (utfärdar
identiteter) och **relying party / klient** (delegerar identitet). Att bygga en
egen IdP är den klassiska "roll-not-your-own"-fällan.

## Beslut

**AVA är en OIDC *relying party* (klient), aldrig en IdP**, med
**bring-your-own-IdP** och enforcement via en tunn forward-auth-proxy i
nginx-fronten.

1. **Konfigurera auth, skriv den inte.** [`oauth2-proxy`](https://oauth2-proxy.github.io/oauth2-proxy/)
   (en Go-binär) körs som nginx `auth_request` framför både static-appen och
   `/git/`. Den gör hela OIDC-dansen (PKCE, sessions-cookie); nginx släpper bara
   igenom autentiserade requests. Ingen egen-skriven auth-kod. (Detalj: [#222](https://github.com/ulrik-s/ava/issues/222).)
2. **Samma-origin-cookie rider med iso-git.** Appen och `/git/` är samma origin
   (poängen med nuvarande setup — ingen CORS-proxy). Sessions-cookien skickas
   därför automatiskt av webbläsaren med iso-gits `fetch` mot `/git/` →
   människan SSO-loggar in en gång, push/pull "bara funkar", ingen
   token-hantering i klienten.
3. **Bring-your-own-IdP via standard OIDC discovery.** Byrån pekar AVA mot sin
   egen IdP — Microsoft Entra ID (M365), Google Workspace, eller BankID/Freja
   via en OIDC-broker (Criipto/Signicat). BankID lämpar sig bäst som **step-up**
   på känsliga operationer snarare än varje login (friktion).
4. **Provisionering = allowlist i firma.git.** `.ava/users/<email>.json`
   (zod, versionerat, ingen DB) med `{ email, role, oidcSubject? }`. Appen mappar
   OIDC-claims → AVA-principal via allowlisten. (Detalj: [#223](https://github.com/ulrik-s/ava/issues/223).)
5. **Maskin-principaler är separata.** server-runtime (#81) och CLI-git-klienter
   använder PAT/deploy-key, inte interaktiv OIDC. En PAT/basic-väg behålls för
   `/git/` vid sidan av OIDC-cookien för icke-browser-klienter.
6. **Hemligheter i valvet.** oauth2-proxy:s client-secret + cookie-secret ligger
   i secrets-valvet (ADR 0008/#79) / env — aldrig i git.

### Onboarding

- **Ny användare:** admin lägger till epost i allowlisten (vidareutveckla
  `add-user.sh` / `auth-server` invite-UI bakom profilen `invite-server`). Vid
  första login binds `oidcSubject`. Okänd identitet utan allowlist-rad nekas
  (autentisering ≠ auktorisering). Avprovisionering = ta bort rad + invalidera
  session.
- **Första användaren (bootstrap):** rotförtroende = den som kör
  `docker compose up` (host shell-access). Vid tom allowlist mint:as en
  **engångs admin-claim-token** som printas i serverloggen (samma mönster som
  dagens admin-PAT-bootstrap); första personen löser in den vid OIDC-login och
  binds som admin, varefter token invalideras. Alternativ: `add-user.sh --admin
  <epost>` på hosten. (Detalj: [#224](https://github.com/ulrik-s/ava/issues/224).)

### Demo-tier

GH Pages-demon har ingen server → ingen riktig auth. Den förblir mock/in-memory,
capability-gated (samma webapp-build i båda tiers; auth-skiktet aktivt endast
self-hosted).

## Konsekvenser

- **+** Ingen egen IdP/auth-kod — den säkerhetskritiska biten outsourcas till en
  beprövad proxy + byråns IdP. Håller "tunn server".
- **+** SSO + MFA "gratis" via byråns befintliga IdP (de flesta byråer har M365).
  Lägre friktion, ingen lösenordshantering i AVA.
- **+** Samma-origin-cookien gör iso-git-flödet sömlöst utan klient-token-kod.
- **+** Provisionering i firma.git — versionerat, ingen DB, "din data".
- **+** Adderar ingen ny obligatorisk komponent (uppgraderar befintlig nginx-front).
- **−** **Identitet** delegeras till en extern IdP. Upplösning av USP-spänningen:
  vi delegerar identitet, **inte data** — data lämnar aldrig firma.git. Men en
  byrå som vägrar *all* extern IdP behöver self-hosted-alternativet (se nedan).
- **−** Auktorisering är fortfarande grov: tills ACL finns (ADR 0001, uppskjuten)
  ger OIDC **identitet + grind till repot**, inte per-rad-behörighet.
- **−** Icke-browser-git-klienter måste ha en separat PAT-väg (kan inte bära
  OIDC-cookien).

## Alternativ (förkastade / uppskjutna)

- **Bygga egen OIDC authorization server** — säkerhetskritiskt, bryter tunn
  server. Nej.
- **Self-hosted IdP (Authelia)** i web-containern — noll tredjepart, max
  suveränitet, men mindre tunn server + egen användarhantering. **Uppskjutet
  tillval** för byråer som vägrar extern IdP; samma oauth2-proxy-front, bara en
  annan issuer. Standard-OIDC-beslutet gör det till en konfig-ändring, inte en
  omarkitektur.
- **Behålla htpasswd/PAT som enda väg** — inget SSO/MFA/sessioner, svag
  människo-auth. Behålls bara för maskin/CLI.
- **Hårdkoda en IdP (t.ex. bara BankID)** — lås-in + friktion. Standard-OIDC +
  BYO-IdP låter byrån välja (BankID kan vara *en* av dem, och step-up senare).
