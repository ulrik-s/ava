# Inloggning via Microsoft / O365 (Entra ID)

AVA stödjer inloggning via Microsoft Entra ID (tidigare Azure AD) i **single-tenant**-läge: en byrå = en Entra-tenant. Alla användare måste tillhöra den tenanten. Lösenordsinloggning (`CredentialsProvider`) finns kvar som fallback för admin och testkonton.

Provisioneringen är **inbjudningsbaserad**: en admin måste skapa användaren i AVA först (via `/users/new`), sedan loggar personen in via Microsoft och konton länkas på e-post. Ingen auto-provisionering.

---

## 1. Azure-sidan (engångsjobb för admin)

1. **Logga in i [Azure-portalen](https://portal.azure.com)** → `Microsoft Entra ID` → `App registrations` → `+ New registration`
2. Fyll i:
   - **Name**: `AVA`
   - **Supported account types**: *Accounts in this organizational directory only (single tenant)*
   - **Redirect URI**: `Web` → `https://<din-avas-domän>/api/auth/callback/azure-ad`
     Lägg även till `http://localhost:3000/api/auth/callback/azure-ad` för utveckling.
3. På **Overview**-sidan, notera:
   - `Application (client) ID` → blir `AZURE_AD_CLIENT_ID`
   - `Directory (tenant) ID` → blir `AZURE_AD_TENANT_ID`
4. **Certificates & secrets** → `+ New client secret` → kopiera **Value**-kolumnen (visas bara en gång) → blir `AZURE_AD_CLIENT_SECRET`.
5. **API permissions** → `+ Add a permission` → `Microsoft Graph` → `Delegated permissions`:
   - `openid`
   - `profile`
   - `email`
   - `offline_access`
   - `User.Read`
   - `Calendars.ReadWrite`
   Klicka sedan **Grant admin consent for <byrå>**. Utan admin consent får användarna varje gång frågan om samtycke.

---

## 2. AVA-sidan

### Miljövariabler (`.env`)

```bash
AZURE_AD_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_AD_CLIENT_SECRET=<hemlighet>
AZURE_AD_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# Redan befintliga
NEXTAUTH_SECRET=<generera med: openssl rand -base64 32>
NEXTAUTH_URL=https://<din-avas-domän>
```

Utan dessa variabler är AzureAD-providern **inaktiverad** och bara lösenordsinloggning visas — så lokala dev-miljöer utan Azure-konfig fungerar som tidigare.

### Databasen

Kör följande en gång per organisation som ska få O365-inloggning:

```sql
UPDATE organizations SET azure_tenant_id = '<samma AZURE_AD_TENANT_ID>' WHERE id = '<org-id>';
```

Detta binder tenanten till organisationen. Tokens från andra tenanter avvisas i `signIn`-callbacken.

---

## 3. Bjuda in en användare

1. Admin → `/users/new` → fyll i **e-post** (samma som O365-UPN), namn, roll. **Lösenord lämnas tomt**.
2. Användaren går till AVA → klickar **"Logga in med Microsoft"** → loggar in med sitt O365-konto.
3. Vid första lyckade login länkar AVA användarens `azureOid` till User-posten (`src/client/lib/azure-provisioning.ts`, `resolveAzureUser`).

### Fel-URL:er (visas som svenskt felmeddelande på `/login`)

| `?error=` | Betydelse |
|---|---|
| `WrongTenant` | Tokenens `tid` matchar ingen organisations `azureTenantId`. Förmodligen fel tenant i portalen. |
| `NotInvited` | Ingen User-post finns med matchande e-post i rätt organisation. Admin måste bjuda in. |
| `MissingEmail` / `MissingClaims` | Token saknar `oid`, `tid` eller `email`. Kontrollera att `email`-scopet är tilldelat. |

---

## 4. Säkerhet

- Användare kan logga in via `CredentialsProvider` **bara om** `passwordHash` är satt. Konton skapade med bara e-post (invite-only) kan inte lösenordsautentiseras.
- `azureOid` är unikt i DB → en Entra-identitet kan bara kopplas till en AVA-User.
- Tenant-binding valideras på varje inloggning. Även om ett konto har `azureOid` satt avvisas det om det hör till fel organisation.
- Refresh-tokens (för senare Microsoft Graph-anrop till kalendern) lagras ännu inte — det tillkommer när kalenderintegrationen byggs ut.

---

## 5. Testning

`src/client/lib/azure-provisioning.test.ts` täcker:
- Återkommande login via `oid`
- Första login via e-post + länkning av `oid`
- Skiftlägesokänslig e-post
- Fel tenant → avvisad
- Ej inbjuden → avvisad
- Korsorg-försök → avvisad
- Saknad e-post → avvisad
- E-postmatch men oid redan tillhör annan identitet → avvisad
