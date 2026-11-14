# Remote-MCP: Claude mot byråns AVA

AVA:s hela API-yta (samma verktyg som `bun run ava:mcp`, ADR 0035) finns på
`https://<domän>/mcp` för Claude på claude.ai, i desktop-appen och i mobilen.
Varje jurist loggar in med **sitt eget Microsoft-konto**. Varje verktygsanrop
körs som den personen, med samma roll och byrå-scoping som i webben, och med
hens namn i ändringsloggen (#1026).

## Hur det fungerar

MCP-spec:ens OAuth-modell. AVA är **resursserver**, byråns Entra-tenant är
**auktoriseringsserver**. AVA lagrar inga tokens och kör ingen egen inloggning.

1. Claude anropar `/mcp` utan token. AVA svarar `401` med
   `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/mcp"`.
2. Dokumentet (RFC 9728) pekar ut Entra-tenanten och scopet.
3. Claude skickar användaren till Microsofts inloggning (med MFA och villkorsstyrd
   åtkomst som vanligt) och får en access-token.
4. Varje anrop bär `Authorization: Bearer <token>`. server-first verifierar den
   (signatur mot Entras nycklar, issuer, `aud`, utgång) och slår upp användaren
   **på e-post** i byråns användarlista, precis som webbinloggningen.

**Förtroendegränsen.** `/mcp` går förbi oauth2-proxy (Caddyfile). Kontexten
byggs därför ur en ny request som bara bär token:en, i `verified`-läge.
`X-Auth-Request-*` från klienten ignoreras på den här vägen
(`tooling/ava-cli/mcp-http.ts`).

| Svar | Betyder |
|---|---|
| `401` utan `error` | Ingen token. Claude startar inloggningen. |
| `401 invalid_token` | Token ogiltig eller utgången. Claude förnyar eller loggar in igen. |
| `403 access_denied` | Token giltig, men e-posten finns inte, är inaktiverad eller finns två gånger i AVA. |

## Uppsättning i Entra (en gång per byrå)

Görs i Entra-admin för byråns tenant av någon med rätt att registrera appar.

1. **Appregistrering för AVA:s API**: *App registrations → New registration*,
   till exempel "AVA MCP". Single tenant.
2. **Exponera ett API**: *Expose an API → Application ID URI* `api://<klient-id>`,
   och lägg till scopet `mcp` ("Använda AVA via Claude som användaren").
   Consent: *Admins only*. Då kan ingen koppla upp sig förrän en admin har
   godkänt appen för byrån (steg 6).
3. **v2-token**: i *Manifest*, sätt `"requestedAccessTokenVersion": 2`
   (under `api`). Då blir `iss` `https://login.microsoftonline.com/<tenant-id>/v2.0`
   och `aud` appens klient-id.
4. **E-post i token**: AVA tar `email`, annars `preferred_username` (UPN).
   Antingen lägger du till `email` som valfritt claim för access-token
   (*Token configuration*), eller ser till att varje AVA-användares e-post är
   **samma som UPN**. Annars nekas personen med `403`, som Maria 2026-11-14:
   `maria.grosskopf@…` i AVA mot UPN `maria@…`.
5. **Klient för Claude**: Entra stöder inte dynamisk klientregistrering, så
   Claude får ett fast klient-id. I samma app: *Authentication → Add a
   platform → Web*, med **båda** Claudes redirect-URI:er:
   `https://claude.ai/api/mcp/auth_callback` och
   `https://claude.com/api/mcp/auth_callback` (Anthropic flyttar mot claude.com,
   och Entra har krävt båda). Skapa sedan en klienthemlighet under
   *Certificates & secrets*. Under *API permissions → Add a permission → APIs
   my organization uses*, sök på appens klient-id och lägg till den delegerade
   behörigheten `mcp`.
6. **Admin consent**: *API permissions → Grant admin consent for <byrån>*.
   Först då kan juristerna logga in via Claude.

## Uppsättning på servern

I produktions-`.env` (läses av `docker-compose.production.yml`):

```bash
AVA_MCP_RESOURCE=https://ava-crm.io/mcp
AVA_MCP_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0
AVA_MCP_AUDIENCE=<klient-id>
AVA_MCP_SCOPES="api://<klient-id>/mcp offline_access"
# AVA_MCP_JWKS_URI  valfri, annars OIDC-discovery ur issuern
```

Starta om server-first. Loggen säger `remote-MCP på https://…/mcp`. Om
`AVA_MCP_RESOURCE` är satt men issuer eller audience saknas startar servern
inte (hellre ingen `/mcp` än en som inte verifierar).

Kontroll:

```bash
curl -s https://ava-crm.io/.well-known/oauth-protected-resource/mcp
curl -si -X POST https://ava-crm.io/mcp | grep -i www-authenticate
```

## I Claude

*Inställningar → Kopplingar (Connectors) → Lägg till anpassad koppling.*
URL: `https://ava-crm.io/mcp`. Under avancerade inställningar anger du
klient-id och klienthemlighet från steg 5. På Team/Enterprise kan en
admin lägga till kopplingen en gång för hela organisationen.

Verktygen är märkta `readOnlyHint` (frågor) och `destructiveHint`
(ändringar). I Claude kan varje användare välja "fråga först" per verktyg.
Rollerna gäller på servern oavsett vad Claude gör.

## Innan byrån slår på det

Klientdata går till Anthropic när Claude använder verktygen. Byrån bör köra
Claude Team eller Enterprise (avtal, ingen träning på data) och ta ett
uttryckligt beslut om det mot advokatsekretessen.
