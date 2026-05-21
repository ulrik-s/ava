# AVA GitHub OAuth Proxy (Cloudflare Worker)

GitHub:s OAuth-endpoints saknar CORS-header, så Web-builden (GH Pages) kan
inte snacka direkt med dem. Den här workern är en tunn pass-through som
lägger till CORS — den lagrar inga tokens och loggar inga requests.

## Vad du behöver

1. **GitHub OAuth App** (https://github.com/settings/developers → New OAuth App)
   - Application name: `AVA`
   - Homepage URL: din AVA-deploy-URL
   - Callback URL: workerns URL `+ /callback` (krävs men används inte)
   - ✅ Enable Device Flow
   - Spara `Client ID` och generera `Client Secret`

2. **Cloudflare-konto** (gratis) + `wrangler` CLI:
   ```bash
   npm i -g wrangler
   wrangler login
   ```

## Setup

```bash
mkdir ava-oauth-proxy && cd ava-oauth-proxy
wrangler init . --type ts
# Skriv över src/index.ts med innehållet i cloudflare-worker.ts från det här repo:t

# wrangler.toml — lägg till:
#   [vars]
#   GITHUB_CLIENT_ID = "<din OAuth App's Client ID>"
#   AVA_ORIGIN       = "https://<din>.github.io"   # eller en lista

wrangler secret put GITHUB_CLIENT_SECRET
# Klistra in Client Secret när den frågar

wrangler deploy
# Workern får en URL som https://ava-oauth-proxy.<account>.workers.dev
```

## Sätta upp i AVA

I `/settings` → Datakälla & inloggning → konfigurera:

- **OAuth proxy URL:** `https://ava-oauth-proxy.<account>.workers.dev`
- **OAuth Client ID:** samma som i wrangler.toml

Spara → klicka "Logga in via GitHub" → följ device-code-flowet.

## Säkerhet

- Workern är stateless — håller ingen state mellan requests
- Tokens passerar bara through; loggas inte
- CORS-allowed-origin begränsas via `AVA_ORIGIN` (sätt till din exakta deploy-URL)
- `GITHUB_CLIENT_SECRET` lagras som Cloudflare-secret (krypterad i transit + vila)
- Device Flow betyder att inget callback-URL behöver träffas — användaren
  godkänner manuellt på github.com/login/device
