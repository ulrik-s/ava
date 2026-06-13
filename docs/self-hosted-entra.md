# Self-hosted AVA med Microsoft-inloggning (Entra ID), lokalt

Den här guiden tar dig från noll till en körande AVA-backend i Docker på din
egen dator, där du loggar in med ditt **Microsoft-konto** (Entra ID / Microsoft
365) via OIDC. Bygger på install-servern (#232) + OIDC-relying-party-modellen
(ADR 0009).

> AVA är en **OIDC relying party** — den äger aldrig dina lösenord. Microsoft
> autentiserar; AVA auktoriserar mot en allowlist i din `firma.git`. Din data
> lämnar aldrig git-repot.

## Förkrav

- Docker Desktop/Engine igång.
- `bun` installerat (`curl -fsSL https://bun.sh/install | bash`).
- Ett Microsoft Entra-konto där du kan registrera en app (Azure Portal →
  *App registrations*).

## Steg 1 — Registrera en app i Entra ID

I [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID** →
**App registrations** → **New registration**:

1. **Name:** `AVA (self-hosted)`.
2. **Supported account types:** *Accounts in this organizational directory only*
   (single-tenant) räcker för en byrå.
3. **Redirect URI:** plattform **Web**, värde
   `http://localhost:8080/oauth2/callback`.
   (`localhost` tillåts av Entra för lokal körning.)
4. Registrera → notera **Application (client) ID** + **Directory (tenant) ID**.
5. **Certificates & secrets** → **New client secret** → kopiera *värdet* (visas
   en gång).
6. **Token configuration** → lägg till en **optional claim** av typ *ID* →
   `email` (så att email-claimen finns; annars matchas på UPN).

Din **issuer-URL** blir:
`https://login.microsoftonline.com/<TENANT_ID>/v2.0`

## Steg 2 — Installera + starta stacken (ett kommando)

```bash
bun run install:server \
  --auth oidc \
  --repo http://localhost:8080/git/firma.git \
  --work-dir "$HOME/.ava/wc" \
  --org "$(uuidgen | tr A-Z a-z)" \
  --oidc-issuer "https://login.microsoftonline.com/<TENANT_ID>/v2.0" \
  --oidc-client-id "<CLIENT_ID>" \
  --oidc-client-secret "<CLIENT_SECRET>" \
  --oidc-redirect "http://localhost:8080/oauth2/callback" \
  --start
```

Det här:
- genererar secrets-valvets master-nyckel (0600, i `~/.ava-secrets/`) + lägger
  klient-/cookie-secret i det krypterade valvet (aldrig i klartext/git),
- skriver en icke-hemlig `ava-server.env`,
- **preflight**-kollar docker + att port 8080 är ledig,
- bygger static-export:en och startar Docker-stacken med **oauth2-proxy mot
  Entra** (BYO-IdP-overlayen — ingen Keycloak), och surfar valv-secreten till
  oauth2-proxy:n.

> Spara `--org`-värdet (UUID:t) — du behöver det i nästa steg och i appens
> inställningar. (Tappar du valvets master-nyckel blir valvet oåterkalleligt.)

## Steg 3 — Seeda din byrå + dig själv som admin

En färsk `firma.git` är tom. Skapa organisationen + din admin-rad (matchar din
Microsoft-email) och pusha:

```bash
git clone http://localhost:8080/git/firma.git "$HOME/.ava/wc"
bun run bootstrap:admin \
  --work-dir "$HOME/.ava/wc" \
  --email "din.epost@byra.se" \
  --org "<samma-org-uuid-som-ovan>" \
  --org-name "Din Advokatbyrå" \
  --commit
git -C "$HOME/.ava/wc" push
```

Detta skriver `.ava/organizations/<org>.json`, `.ava/meta.json` och
`.ava/users/din.epost@byra.se.json` (role=ADMIN) och pushar till stacken.
Idempotent — kör om utan risk.

## Steg 4 — Logga in

Öppna **http://localhost:8080/ava/**. oauth2-proxy skickar dig till Microsoft;
logga in med ditt konto. Tillbaka i AVA matchas din email mot allowlisten →
du resolvas som **ADMIN**. Klart.

> Är din email INTE i allowlisten visar AVA "Inte behörig" — det är meningen
> (autentisering ≠ auktorisering). Lägg till fler användare genom att skapa dem
> i appen (Användare) eller köra `bootstrap:admin` igen per epost.

## Felsökning

- **`port 8080 är upptagen`** — stoppa tjänsten som använder porten (preflight
  avbryter starten innan något halvstartas).
- **`docker hittades inte`** — starta Docker Desktop.
- **Microsoft visar "redirect URI mismatch"** — redirect-URI:n i app-
  registreringen måste vara EXAKT `http://localhost:8080/oauth2/callback`.
- **oauth2-proxy startar inte: `issuer did not match … got https://login.microsoftonline.com/{tenantid}/v2.0`**
  — du använder multi-tenant-endpointen (`/common/` eller `/organizations/`),
  vars discovery-issuer är templad. Använd din **konkreta tenant-issuer**
  (`https://login.microsoftonline.com/<TENANT_ID>/v2.0`, rekommenderat), eller
  sätt `OIDC_SKIP_ISSUER_VERIFICATION=true` i miljön före `--start` om du
  medvetet kör multi-tenant.
- **"Inte behörig" trots inloggning** — din Microsoft-email matchar ingen
  allowlist-rad. Kontrollera att `--email` i steg 3 är samma email Entra
  returnerar (kolla `email`/UPN i token-claims).
- **Riva stacken:** `bun run install:server --auth oidc --down` (valvet lämnas
  orört).

## Skarp drift (utöver lokalt)

Bakom riktig HTTPS: sätt `OIDC_COOKIE_SECURE=true` och en publik
`--oidc-redirect`/redirect-URI. Maskin-/CLI-klienter (git clone, server-runtime)
använder PAT separat från människo-OIDC. Se [`docs/auth.md`](auth.md) + ADR 0009.
