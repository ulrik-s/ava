# AVA GitHub OAuth Proxy (Cloudflare Worker)

GitHub:s OAuth-endpoints saknar CORS-header, så Web-builden (GH Pages) kan
inte snacka direkt med dem. Den här workern är en tunn pass-through som
lägger till CORS — den lagrar inga tokens och loggar inga requests.

## Kostnad

**Gratis** för AVA-skala. Cloudflare Workers' free tier ger 100,000
requests/dag (kreditkort krävs inte). Varje OAuth-login är ~3 requests,
så taket är runt 33,000 logins/dag.

## Setup-steg

### 1. GitHub OAuth App

Gå till https://github.com/settings/developers → **New OAuth App**:

- **Application name:** `AVA`
- **Homepage URL:** din AVA-deploy-URL (t.ex. `https://anna.github.io/ava-firman`)
- **Authorization callback URL:** workerns URL `+ /callback` (krävs av GH-formuläret men används inte i device-flow)
- ✅ **Enable Device Flow**

Spara `Client ID` (publik) och generera ett `Client Secret` (hemlig — du
ska aldrig checka in detta).

### 2. Cloudflare-konto + wrangler-CLI

```bash
# Engångsinstallation
npm i -g wrangler

# Logga in (öppnar Cloudflare i browser:n)
wrangler login
```

Inget kreditkort behövs.

### 3. Worker-projekt

```bash
mkdir ava-oauth-proxy && cd ava-oauth-proxy
mkdir src

# Kopiera filerna från det här repo:t (scripts/oauth-proxy/)
cp /<sökväg-till-ava>/scripts/oauth-proxy/cloudflare-worker.ts src/index.ts
cp /<sökväg-till-ava>/scripts/oauth-proxy/wrangler.toml.template wrangler.toml

# Redigera wrangler.toml och fyll i:
#   GITHUB_CLIENT_ID = "Ov23li_..."   (från steg 1)
#   AVA_ORIGIN = "https://<din>.github.io"   (din exakta deploy-origin)
```

### 4. Lagra Client Secret

```bash
wrangler secret put GITHUB_CLIENT_SECRET
# Klistra in Client Secret när den frågar.
# Secret krypteras at-rest på Cloudflare; syns aldrig i workern:s kod.
```

### 5. Deploya

```bash
wrangler deploy
```

Workern får en URL som `https://ava-oauth-proxy.<account>.workers.dev`.
Den syns också i Cloudflare Dashboard → Workers & Pages.

### 6. Konfigurera AVA

I AVA `/settings` → Datakälla & inloggning → klicka **"OAuth-config"**:

- **OAuth proxy URL:** `https://ava-oauth-proxy.<account>.workers.dev`
- **OAuth Client ID:** samma värde som i `wrangler.toml` `GITHUB_CLIENT_ID`

Klicka **Spara**. Då dyker **"Logga in via GitHub"**-knappen upp och
PAT-fältet behövs inte längre.

## Verifiera deploy

Du kan testa proxy:n direkt från terminalen:

```bash
curl -X POST https://ava-oauth-proxy.<account>.workers.dev/device/code
# Förväntat svar: { "device_code": "...", "user_code": "ABCD-1234", ... }
```

Eller från AVA:n: efter att du klistrat in URL:en + Client ID, klicka
"Logga in via GitHub" → en device-code-vy ska dyka upp.

## Säkerhet

- Workern är stateless — håller ingen state mellan requests
- Tokens passerar bara through; loggas inte
- CORS-allowed-origin begränsas via `AVA_ORIGIN` (sätt till din exakta deploy-URL)
- `GITHUB_CLIENT_SECRET` lagras som Cloudflare-secret (krypterad in transit + at-rest)
- Device Flow betyder att inget callback-URL behöver träffas — användaren
  godkänner manuellt på github.com/login/device
- Workern är ren TypeScript med standardiserat fetch-API — kan flyttas
  till Vercel/Netlify/eget hostingmiljö om du senare vill det

## Felsökning

- **"Proxy 401"** → Client Secret är fel eller saknas. Sätt om via
  `wrangler secret put GITHUB_CLIENT_SECRET`.
- **"CORS-fel" i browser:n** → `AVA_ORIGIN` matchar inte deploy-URL:en
  exakt. Måste vara protokoll + domän, ingen path/trailing slash.
- **"Device Flow ej aktiverat"** → checka att rutan är ikryssad på din
  OAuth App i github.com/settings/developers.
