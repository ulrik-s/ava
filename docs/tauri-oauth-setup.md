# Setup — GitHub OAuth Device Flow för Tauri-byggen

För att Tauri-appen ska kunna logga in användare via GitHub utan
manuell PAT-paste behöver du registrera en **GitHub OAuth App** med
Device Flow aktiverat och bygga Tauri-binär med ditt client_id som
env-var.

## 1. Registrera OAuth App

1. Gå till <https://github.com/settings/developers> → "OAuth Apps" →
   "New OAuth App"
2. **Application name**: `AVA — <din firma>`
3. **Homepage URL**: `https://github.com/<din-firma>`
4. **Authorization callback URL**: `http://localhost` (ignoreras vid
   device flow men obligatoriskt fält)
5. Klicka "Register application"
6. På appens settings-sida:
   - Bocka i **"Enable Device Flow"**
   - Notera **Client ID** (`Ov23xxxxxxxxxxxx`)
7. **Inget client_secret behövs** för Device Flow

## 2. Bygg Tauri med client_id

```bash
AVA_GITHUB_CLIENT_ID=Ov23xxxxxxxxxxxx yarn tauri build
```

Detta sätts som compile-time-konstant i `src-tauri/src/lib.rs`.

För dev-läge:
```bash
AVA_GITHUB_CLIENT_ID=Ov23xxxxxxxxxxxx yarn tauri dev
```

## 3. Användarflöde

1. Användare öppnar appen
2. Klickar "Logga in via GitHub" i clone-wizard eller settings
3. AVA visar en 8-tecken kod (t.ex. `WXYZ-1234`)
4. AVA öppnar `https://github.com/login/device` i default-browsern
5. Användaren skriver in koden + godkänner repo-scopet
6. AVA pollar tills tokenen är klar (~5-10s)
7. Token lagras automatiskt i OS-keychain (macOS Keychain, Windows
   Credential Manager, Linux Secret Service)

## Scopes som begärs

Default: `repo` (full read/write till alla repos användaren har
tillgång till). Detta krävs för push.

För minimal access: ändra `scope`-argumentet i
`OAuthDeviceFlow`-komponenten till t.ex. `public_repo`.

## Säkerhet

- Tokens skickas aldrig till någon server utanför github.com
- Tokens lagras krypterat i OS-keychain (ej i localStorage / fil)
- Tokens kan återkallas på <https://github.com/settings/applications>
- Vid avinstallation: `secret_delete("github-token")` rensar
  keychain-posten

## Felsökning

| Symptom | Orsak |
|---|---|
| `AVA_GITHUB_CLIENT_ID är inte satt` | Bygg utan env-var. Sätt vid `tauri build`/`tauri dev`. |
| `Koden gick ut` | Användaren tog för lång tid (>15 min). Klicka igen. |
| `device_flow_disabled` | OAuth-appen har inte Device Flow aktiverat. Settings → enable. |
| Token sparas inte | Keychain-permissioner saknas. macOS: bevilja keychain-access. |
