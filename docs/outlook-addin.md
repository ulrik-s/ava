# Outlook-tillägget i produktion

Juristen öppnar ett mejl i Outlook (Mac, webben eller Windows), klickar **AVA**,
ser *"Inloggad som …"*, söker ärende och klickar **Spara**. Mejlet (.eml) och en
valfri tidspost hamnar på ärendet i AVA. Hon behöver inte installera något eller
logga in i tillägget.

## Hur det hänger ihop

| Del | Var |
|---|---|
| Task-panen | `https://<AVA-domän>/addin/taskpane.html`, byggs in i varje deploy (`office-addin/build.ts --out out/addin`) |
| Manifest | `https://<AVA-domän>/addin/manifest.xml`, genererat per deploy ur `office-addin/manifests/outlook-manifest.xml` |
| Konfiguration | `/addin/config.js`: Entra-appens klient-id och tenant ur `OAUTH2_PROXY_CLIENT_ID` och `OIDC_ISSUER_URL` |
| Inloggning | Nested App Authentication (NAA) via MSAL: Outlook lämnar ut token tyst (`src/lib/client/addin/addin-auth.ts`) |
| Mejlet | Microsoft Graph `GET /me/messages/{id}/$value` med en `Mail.Read`-token |
| AVA:s API | `/api/trpc` på samma origin med `Authorization: Bearer <Entra-token>` för `api://<klient-id>/access_as_user` |

**Ingen ny serverväg.** Bearer-token mot `/api` valideras av oauth2-proxy
(`OAUTH2_PROXY_SKIP_JWT_BEARER_TOKENS`, alltså `AVA_HELPER_ENABLED=true`),
samma väg som AVA Helper använder. Proxyn kräver `aud` = klient-id (v2-token)
och ett `email`-claim, och sätter identiteten. Servern slår upp användaren på
e-post som vanligt: samma roll och byrå som i webben.

**Varför NAA och Graph:** Microsoft stängde av de gamla Exchange-token
(`getCallbackTokenAsync`) för alla tenants i oktober 2025, och undantaget för
tillägg mot Outlook REST v2.0 upphörde samtidigt.

## Entra (en gång per byrå)

På **samma app som webbinloggningen** (`OAUTH2_PROXY_CLIENT_ID`), utöver det
som redan krävs för AVA Helper (docs/self-hosted-entra.md):

1. **Authentication → Add a platform → Single-page application** med redirect-URI
   `brk-multihub://<AVA-domän>` (t.ex. `brk-multihub://ava-crm.io`). Det är NAA:s
   mäklar-URI.
2. **API permissions → Microsoft Graph → Delegated → `Mail.Read`**, och
   **Grant admin consent**.
3. Redan på plats för AVA Helper: scopet `access_as_user` (*Expose an API*),
   `requestedAccessTokenVersion: 2` och `email` som valfritt claim för
   **Access**-token.

För MGA gjordes steg 1–2 den 2026-11-15.

## Servern

Inget nytt i `ava-server.env` utöver det som redan finns: `AVA_DOMAIN`,
`OAUTH2_PROXY_CLIENT_ID`, `OIDC_ISSUER_URL` och `AVA_HELPER_ENABLED=true`.
Deployen bygger tillägget. Kontroll efter deploy:

```bash
curl -s https://ava-crm.io/addin/config.js
curl -s https://ava-crm.io/addin/manifest.xml | grep -E "SourceLocation|<Version>"
```

## Utrullning (pilot först)

*Microsoft 365 admin center → Inställningar → Integrerade appar → Ladda upp
anpassade appar → Office-tillägg → Ange länk till manifestfilen*:
`https://ava-crm.io/addin/manifest.xml`. Välj **Specifika användare** för
piloten (t.ex. Ulrik, Cecilia, Maria) och utöka till hela byrån när den
fungerar. Tillägget dyker upp i Outlook inom några timmar (upp till ett dygn).

Kodändringar når användarna med nästa deploy, eftersom panelen laddas från
AVA. Manifestet behöver bara laddas upp igen om det själv ändras.

## Om något inte fungerar

| Panelen säger | Orsak |
|---|---|
| *inte konfigurerat* | `config.js` saknar klient-id eller tenant: kontrollera `OAUTH2_PROXY_CLIENT_ID`/`OIDC_ISSUER_URL` och deploya igen |
| *Inloggningen misslyckades* | NAA nekades: saknad SPA-redirect, admin consent för `Mail.Read`, eller gamla Outlook för Mac (stöder inte NAA; använd nya Outlook) |
| *AVA kände inte igen inloggningen* | Token avvisades: oauth2-proxy saknar `SKIP_JWT_BEARER_TOKENS`, eller fel audience |
| *ditt konto finns inte i AVA* | E-posten i token (`email`/UPN) matchar ingen aktiv användare i AVA (jfr Maria 2026-11-14) |

## Tester

Se `docs/quality.md` → *Outlook-tillägget i CI*. E2E:n kör den byggda panelen
med fasta token (`staticTokens` i `config.js`) och en Graph-fejk. NAA mot riktiga
Outlook verifieras med checklistan i
[office-addin/README.md](../office-addin/README.md#värdverifiering--checklistan-1077).
