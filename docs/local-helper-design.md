# Lokal helper — designdokument

## Problemställning

Web-AVA fungerar utmärkt för läsning + skrivning till GitHub via PAT över
HTTPS. Det som **inte** går från en ren web-app:

1. SSH-push (browser:n kan inte tala SSH-protokollet)
2. Öppna PDF i OS:s default-app (PDFGear, Acrobat) — Chrome öppnar bara
   i egna PDF-viewern
3. Riktigt OS-keychain-tillgång (Mac Keychain, Windows Credential Store)
4. Filsystemet utanför FSA-handeln (t.ex. `~/.ssh/id_ed25519`)

Vi vill **inte** Tauri pga distribution-komplexitet. En **headless helper**
ger de viktigaste superkrafterna utan den smärtan.

## Arkitektur: ava-helper

Ett enskilt statiskt binärt program (Rust, ~3-5 MB) som körs som en lokal
HTTP-server på `127.0.0.1:7747` (eller random port om upptagen). AVA i
browser:n fetch:ar mot den.

```
┌─ AVA i Chrome ──────────────┐         ┌─ ava-helper (Rust) ─────┐
│ fetch("http://127.0.0.1:    │ ──HTTP──▶│ git_push (libgit2)     │
│   7747/git/push", {token})  │ ◀────────│ open_pdf (xdg-open)    │
│                             │         │ ssh_sign (libssh2)     │
└─────────────────────────────┘         └────────────────────────┘
              └── localhost-only, auth-token-gate
```

## Komponenter

### 1. Helper-binären (Rust)

**Crates** (alla statisk-länkade så binär är fristående):

- `git2` (libgit2-bindning) — clone/fetch/push/commit utan att kalla git
- `ssh2` eller `russh` — SSH-protokollet
- `axum` eller `hyper` — HTTP-server
- `serde` — JSON-serialisering
- `tokio` — async runtime
- `keyring` — OS-keychain-tillgång (samma som vi använder i Tauri-spåret)

**Binärstorlek**: ~3-5 MB (statisk länkning av libgit2 + libssh2 är största delen)

### 2. HTTP-API

```
GET  /health
     → 200 { version, capabilities, defaultRepoPath? }

POST /git/clone   { url, dir, branch? }
POST /git/pull    { dir, branch? }
POST /git/push    { dir, branch? }                       → { oid }
POST /git/status  { dir }                                → { entries }
POST /git/commit  { dir, message, sign?: boolean }       → { oid }
POST /open        { path }                               → { ok: true }
POST /ssh/sign    { data: <base64> }                     → { sig }

GET  /keys                                               → { ssh: [...] }
POST /keys/generate { comment }                          → { publicKey, fingerprint }
DELETE /keys/{id}
```

Alla requests inkluderar `X-Ava-Token: <token>` header. Tokenet
genereras vid `ava-helper init` och är specifikt per installation.

### 3. CLI-kommandon

```bash
ava-helper init                  # Genererar token + skriver konfig
ava-helper start                 # Startar HTTP-server (default: 7747)
ava-helper install-service       # Sätt upp launchd/systemd för auto-start
ava-helper token                 # Visa nuvarande token
ava-helper update                # Hämta senaste version från GitHub
ava-helper status                # Visa version + körstatus
```

### 4. Konfig-fil

`~/.config/ava-helper/config.toml`:

```toml
[server]
host = "127.0.0.1"
port = 7747

[security]
token = "ava_helper_<random-64-byte>"
# Vilka origin:s som får anropa
allowed_origins = [
  "https://anna.github.io",
  "https://firman.github.io",
]

[keys]
ssh_dir = "~/.ssh"            # Var SSH-nycklar lagras (default = standard)
use_os_keychain = true         # Token-passphrase via Keychain/CredStore
```

## Distribution

### Install-script

**macOS / Linux** (en kommandorad — samma mönster som rustup/deno/bun):

```bash
curl -sSL https://ava-helper.example.com/install.sh | sh
```

Skriptet:
1. Detekterar OS + arch (`uname -sm`)
2. Laddar ner rätt binär från GitHub Releases
3. Verifierar SHA256 mot publicerad summa
4. Placerar i `~/.local/bin/ava-helper` + `chmod +x`
5. Lägger till i PATH (eller berättar för användaren att göra det)
6. Kör `ava-helper init` för att generera token
7. Skriver ut token + Url till AVA:s `/settings` så användaren kan klistra in

**Windows PowerShell**:

```powershell
iwr -useb https://ava-helper.example.com/install.ps1 | iex
```

### Code signing — valfritt initialt

- **macOS Gatekeeper** kommer varna första gången — fix:
  `xattr -d com.apple.quarantine ~/.local/bin/ava-helper` (dokumenterat
  i install-skriptet). Senare: Apple Developer ID för $99/år och
  `codesign --options=runtime --sign "<id>" ava-helper`.
- **Windows SmartScreen** kan varna — fix: "Mer info" → "Kör ändå".
  Senare: EV cert för ~$300/år.
- **Linux**: ingen sigantur krävs.

Eftersom det är en CLI (ingen GUI) är friktionen liten — en advokat som
laddar ner en CLI förväntar sig en terminal-prompt.

### Auto-update

Helper-binären kollar GitHub Releases API vid start. Om ny version
finns laddar den ner till temp-fil + atomic-replace via
`std::fs::rename`. Användaren ser bara att den uppdaterades — inga
popup:s, inga downtime.

```rust
async fn check_update() -> anyhow::Result<()> {
  let latest = github_releases::latest("ava-org/ava-helper").await?;
  if latest.tag > current_version() {
    let bin = github_releases::download_asset(&latest, current_target()).await?;
    let path = std::env::current_exe()?;
    let tmp = path.with_extension("new");
    std::fs::write(&tmp, &bin)?;
    std::fs::rename(&tmp, &path)?;  // atomic på POSIX, kvasi-atomic på Windows
  }
  Ok(())
}
```

~50 rader Rust totalt.

## Bootstrap-flödet i AVA

I `/settings` → ny sektion "Lokal helper":

```
┌─ Lokal helper ─────────────────────────────────────────┐
│                                                        │
│ Status: ○ Söker efter helper…                          │
│         ✗ Ingen helper hittad                          │
│         ✓ Ansluten (v1.2.3)                            │
│                                                        │
│ Helper:n ger AVA SSH-push, 'Öppna i PDFGear', och     │
│ riktig OS-keychain-tillgång.                          │
│                                                        │
│ Installera:                                            │
│ $ curl -sSL https://ava-helper.example.com/install.sh \│
│    | sh                                                │
│ [Kopiera] [Visa Windows-version]                       │
│                                                        │
│ Helper-token: [_____________________] [Verifiera]      │
└────────────────────────────────────────────────────────┘
```

AVA pingar `http://127.0.0.1:7747/health` vid mount + var 30:e sekund så
status uppdateras live.

## Säkerhetsmodell

### Vad andra webbsidor INTE kan göra

- Random sites vet inte vilken port helper:n lyssnar på (random per install)
- Även om de gissar: saknar `X-Ava-Token`-värdet (genereras lokalt,
  skickas bara till AVA:ns origin)
- Helper:n binder bara till `127.0.0.1`, inte `0.0.0.0` — onåbar från LAN
- CORS-allow-origin matchar `allowed_origins` i config, inte `*`
- Helper:n kontrollerar `Origin`-headern + token vid VARJE request
- Rate-limit: max 10 req/s per origin för att förhindra brute-force

### Vad användaren själv riskerar

- Privata SSH-nyckeln ligger på disk i `~/.ssh/` eller
  `~/.config/ava-helper/keys/` (filsystem-rättigheter `0600`)
- Vid OS-kompromittering förlorar de nyckeln — gäller alla SSH-nycklar
- Token-passphrase kan lagras i OS-keychain (Mac Keychain / Windows
  Credential Manager / libsecret) via `keyring`-crate

### Hot-modeller

| Hot | Mitigation |
|---|---|
| Skadlig webbsida i samma browser | Origin-check + token + random port |
| Malware på samma användarkonto | Lika illa som vanlig SSH-användning |
| MITM på localhost | Inte möjligt — paket kommer aldrig ut på nätverket |
| Token-läcka via JS-extension | Token roteras vid behov; rotation via `ava-helper rotate` |

## Vad användaren behöver installera

**Bara helper-binären.** Allt annat är statiskt länkat:

- ✅ `libgit2` bundlad → ingen `git` CLI behövs
- ✅ `libssh2` bundlad → ingen separat SSH-klient
- ✅ `libcurl` bundlad → HTTPS-fallback om SSH inte fungerar
- ✅ OS-keychain via `keyring`-crate

Storlek: ~3-5 MB. Installations-tid: ~10 sekunder (curl + chmod).

## Upgrade-vägar

| Nuläge | Fas | Effort |
|---|---|---|
| Web-only + PAT | Idag | 0 |
| Web + ava-helper (SSH-push, PDFGear) | Fas 1 | ~2-3 veckor Rust + UI |
| Web + ava-helper + OAuth-worker (PAT-fri) | Fas 2 | + 0.5 vecka |
| Web + ava-helper + signed commits | Fas 3 | + 0.5 vecka (vi har redan SSHSIG) |
| Tier 3 self-hosted git | Fas 4 | Ingen helper-ändring krävs |

## Sammanfattning

Helper:n är **opt-in** för power-users som vill ha SSH, PDFGear-öppnande
och OS-keychain. Web-AVA fungerar utan den (PAT + Chrome PDF). Den är
inte en "annan app" — den är en transparent förlängning av AVA.

Användarna behöver **INTE** installera git, SSH-klient eller något annat
runtime. En enda binärfil, en curl-rad att installera.

Det här är arkitektoniskt en mellanväg mellan "ren webapp" och "Tauri":
inga GUI-bundles, inga code-signing-krav initialt, ingen webview-version
att kämpa mot. Bara en HTTP-server på localhost.
