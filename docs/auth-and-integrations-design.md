# Auth + integrationer — designdokument

## Tensionen

Användaren vill ha:
1. **Gerrit-style identitet** — användare i `users.json`, registrerar
   själv sina nycklar i sin profil. Inget login/logout-flöde.
2. **Office 365-integration** — kräver Microsoft-inloggning per
   användare. Outlook, OneDrive, SharePoint, Teams = OAuth-tokens.

Dessa är inte motstridiga om vi separerar två lager:

| Lager | Vad | Var lagras | Vem äger |
|---|---|---|---|
| **AVA-identitet** | Vem du är *i AVA* (namn, roll, mejl, kontor) | `users.json` i firmans git-repo | Admin (skapar), användaren (fyller i nycklar) |
| **Integration-tokens** | Åtkomstnycklar till externa tjänster (O365, Google, …) | Browser-lokalt per device (IndexedDB + WebCrypto, eller Tauri-keychain) | Användaren själv |

Identiteten är *delad* (hela teamet ser att Anna jobbar på firman).
Tokens är *privata* (Anna:s O365-token är hennes och hennes ensam, syns
aldrig i git, syns aldrig för admin).

## Identitetslager — Gerrit-style

### Schema (`users/<id>.json`)

```json
{
  "id": "anna-andersson",
  "displayName": "Anna Andersson",
  "email": "anna@firman.se",
  "role": "lawyer",
  "officeId": "stockholm",
  "active": true,
  "createdAt": "2026-05-21T08:00:00Z",
  "createdBy": "admin-ulrik",
  "publicKeys": {
    "ssh": [
      { "fingerprint": "SHA256:abc...", "type": "ed25519", "comment": "MacBook Pro", "addedAt": "..." }
    ],
    "gpg": []
  },
  "preferences": {
    "language": "sv",
    "timezone": "Europe/Stockholm"
  }
}
```

### Roller

- `admin` — kan skapa/inaktivera användare, ändra rolltilldelningar
- `lawyer` — full skriv-access till egna + delegerade ärenden
- `paralegal` — biträde, begränsad skriv-access
- `accountant` — bara faktura/tids-modulen
- `readonly` — endast läs (revisor, praktikant)

### Identifiering vid commit

Varje git-commit som AVA gör signeras med användarens nyckel:
- SSH-signed commit (`git config gpg.format ssh`) — modern, fungerar
  med samma nyckel som push:n
- GPG-signed commit (klassisk) — om användaren föredrar

Demoläget (anonym/PAT) kvarstår som specialfall: identitet är
"demo-user" och commits signeras inte.

### Profilsida `/profile`

Användaren själv kan:
- Lägga till/ta bort SSH/GPG-nycklar (med fingerprint-bekräftelse)
- Ändra display-namn, mejl (men inte `id` eller `role`)
- Hantera språk/timezone

**Detta är inte "login" — det är en vanlig formvy.** Användaren
identifieras genom att browser:n har en local secret key som matchar
en av nycklarna i deras profil.

### Admin-vy `/users`

Admin kan:
- Skapa ny användare (id, mejl, roll). Användaren fyller sedan i
  sina egna nycklar.
- Inaktivera (sätt `active: false`) — bevarar historik
- Ändra roll

Admin kan **inte** se eller hantera andra användares tokens.

## Integration-lager — OAuth-tokens

### Connector-pattern

Varje extern tjänst implementerar `IntegrationConnector`:

```ts
interface IntegrationConnector {
  id: string;                          // "office365", "google", "dropbox"
  displayName: string;                 // "Office 365"
  capabilities: string[];              // ["outlook", "onedrive", "sharepoint"]
  isConnected(): Promise<boolean>;
  connect(): Promise<void>;            // Startar OAuth-flow
  disconnect(): Promise<void>;
  getAccessToken(): Promise<string>;   // Auto-refresh internally
  // Per-feature operations
  outlook?: OutlookOps;
  onedrive?: OneDriveOps;
  // ...
}
```

### Lagring av tokens

Per-device, never in git:

- **Web (browser)**: IndexedDB med WebCrypto-encryption där nyckeln
  härleds från användarens lösenord till AVA. Tokens raderas vid
  logout-from-this-device.
- **Tauri (desktop)**: OS-keychain (samma som vi redan använder för
  GitHub PAT).

Refresh-tokens lever länge (90 dagar för Microsoft). Access-tokens
refresheras automatiskt i bakgrunden via connector:n.

### O365 specifikt — MSAL.js + PKCE

Microsoft Identity Platform stödjer **OAuth2 + PKCE för SPA:s direkt
mot `login.microsoftonline.com`** — *ingen proxy behövs*, till
skillnad från GitHub. Vi använder Microsoft:s officiella library
`@azure/msal-browser`.

Flow:
1. Användaren klickar "Anslut Office 365" i /profile
2. MSAL.js öppnar popup mot Microsoft → användaren loggar in + godkänner scopes
3. Tokens lagras i IndexedDB via MSAL.js's interna cache
4. AVA:s `Office365Connector` exponerar `outlook.listMail()`,
   `onedrive.downloadFile()` etc.

Scopes vi sannolikt vill ha:
- `User.Read` (basinfo)
- `Mail.ReadWrite` (Outlook-integration)
- `Files.ReadWrite.All` (OneDrive)
- `Sites.Read.All` (SharePoint)
- `offline_access` (refresh-tokens)

### App-registrering

Firman måste registrera en **Azure App Registration** för AVA:
- Application type: Single-page application
- Redirect URI: `https://<deploy>/oauth/callback/office365` (måste matcha exakt)
- Implicit/Hybrid: ej aktiverat (vi använder PKCE)
- API permissions: scopes ovan + admin consent där det krävs

Client ID + Authority sätts i `/settings` (likt OAuth-proxyn vi gjorde
för GitHub). Inget secret behövs eftersom PKCE.

### UI

Profilsidan får en section "Anslutna tjänster":

```
Office 365              [anslut/koppla bort]
  ✓ anna@firman.se · Mail, OneDrive · senast använd 13:42

Google Workspace        [anslut]
  Ej ansluten

Dropbox                 [anslut]
  Ej ansluten
```

Per-feature toggles (eg "läs in mejl automatiskt vid ärendeskapande")
hanteras i resp. integration-vy, inte här.

## Identitet ↔ Integration — bindningen

Tokens är knutna till AVA-identiteten via `userId`:
- Anna är inloggad som `anna-andersson` (via sin SSH-nyckel)
- Anna ansluter Office 365 → token sparas under nyckeln
  `integration:office365:anna-andersson` i IndexedDB
- Anna byter device → måste ansluta om (tokens är per-device)
- Anna inaktiveras (admin) → admin kan inte radera Anna:s tokens
  (de finns inte i git), men Anna kan inte längre logga in i AVA
  så de blir oåtkomliga ändå

Detta ger:
- **Säkerhet**: tokens läcker inte till andra användare via git
- **Portabilitet**: identiteten är fortfarande git-baserad, inte beroende av Azure
- **Audit**: commits signeras med Anna:s nyckel → vi vet att det var
  Anna, oavsett vilken device hon kom från

## Jobb-kö-integration

Tunga integration-operationer (sync av 1000 mejl, OneDrive-folder-scan)
körs via jobb-kön vi just byggde:
- `kind: "o365-sync-mail"`, `payload: { folderId, since }`
- Cancel-bart, progress-rapporterande
- Single-flight per kind så ingen dubbel-sync

## Implementationsordning (förslag)

1. **Användardatabas** + roller (task #22) — fundamentet
2. **Admin-vy** för skapa/inaktivera (task #23)
3. **Profil-vy** för nycklar
4. **IntegrationConnector-interface + registry**
5. **Office365Connector via MSAL.js** med Outlook-läsning som första
   feature (visa mejl per ärende)
6. **Auto-refresh + felhantering** för tokens
7. **Övriga connectors** efter behov (Google Workspace, Dropbox)

## Demoläget

Eftersom demon kör utan riktig firma:
- "demo-user" har ingen `/profile` (read-only)
- Integration-connectors visas men knapparna är disabled med tooltip
  "Endast i full-deploy"
- Detta hindrar inte att vi kan demonstrera UI:n
