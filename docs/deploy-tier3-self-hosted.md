# Tier 3 — Self-hosted produktion (Cleura / Linux + SSH)

Den här guiden beskriver hur en byrå går från Tier 2 (privat GitHub-repo)
till **Tier 3 (egen Linux-server)** med både SSH-access för Tauri/CLI
och HTTPS-access för web-klienter.

## Arkitektur

```
                   ┌──────────────────────────────────────┐
                   │  Cleura / Linux-server (firma.se)    │
                   │                                      │
                   │  /srv/git/<firma>.git/  (bare repo)  │
                   │                                      │
                   │  SSH-server   :22  (git-shell)       │
                   │  HTTPS-server :443 (git-http-backend)│
                   └──────────────────────────────────────┘
                              │              │
                ┌─────────────┘              └─────────────┐
                │                                          │
       ┌────────▼─────────┐                       ┌────────▼─────────┐
       │  Tauri-klient    │                       │  Web (Chrome)    │
       │                  │                       │                  │
       │  git@firma.se:   │                       │  https://firma.se│
       │   <firma>.git    │                       │   /git/<firma>   │
       │  via libssh +    │                       │  via isomorphic- │
       │  ssh-agent       │                       │  git + token     │
       └──────────────────┘                       └──────────────────┘
```

## Steg 1 — Sätt upp bare repo på servern

```bash
# På Cleura-servern (Ubuntu/Debian)
sudo apt install -y git apache2-utils
sudo useradd -r -m -s /usr/bin/git-shell git-firma
sudo -u git-firma mkdir -p /home/git-firma/repos
sudo -u git-firma git init --bare /home/git-firma/repos/firma.git
```

## Steg 2 — SSH-access för Tauri-klienter

Varje användare lägger till sin publika SSH-nyckel:

```bash
# På klientens dator (en gång)
ssh-copy-id git-firma@firma.se

# Begränsa till git-only via authorized_keys command-flagga
# (på servern, /home/git-firma/.ssh/authorized_keys):
# command="git-shell -c \"$SSH_ORIGINAL_COMMAND\"",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty <user-pub-key>
```

**Tauri-klient klonar via SSH:**

```
Repo: git@firma.se:repos/firma.git
```

Tauri:s `git_clone`-command stöder SSH via libgit2 (vendored-openssl).
Klient måste ha `~/.ssh/id_ed25519` (eller motsvarande) som matchar
nyckeln på servern.

## Steg 3 — HTTPS-access för web-klienter

Browsers kan inte SSH:a — vi behöver smart-HTTP-endpoint. Två val:

### A. `git-http-backend` (minimal)

```bash
# /etc/nginx/sites-available/firma.se
server {
    listen 443 ssl http2;
    server_name firma.se;

    ssl_certificate     /etc/letsencrypt/live/firma.se/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/firma.se/privkey.pem;

    location ~ ^/git/ {
        client_max_body_size 100M;
        fastcgi_param GIT_HTTP_EXPORT_ALL "";
        fastcgi_param GIT_PROJECT_ROOT /home/git-firma/repos;
        fastcgi_param PATH_INFO $1;
        fastcgi_param REMOTE_USER $remote_user;
        fastcgi_pass unix:/var/run/fcgiwrap.socket;
        fastcgi_param SCRIPT_FILENAME /usr/lib/git-core/git-http-backend;
        include fastcgi_params;

        # Per-user-auth via tokens
        auth_basic "AVA Git";
        auth_basic_user_file /etc/nginx/htpasswd.firma;

        # CORS — krävs för isomorphic-git från browser
        add_header Access-Control-Allow-Origin "https://ava.firma.se" always;
        add_header Access-Control-Allow-Credentials "true" always;
        add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Authorization, Content-Type, Git-Protocol" always;
        if ($request_method = OPTIONS) { return 204; }
    }
}
```

Skapa token per användare:

```bash
sudo htpasswd /etc/nginx/htpasswd.firma anna   # promptar lösenord/token
```

Web-klient klonar via:
```
Repo: https://firma.se/git/firma
Token: <htpasswd-värdet>
```

### B. Gitea (full webserver med UI)

Om byrån vill ha pull-requests, issues, etc. — installera `gitea`
istället. Stöder både SSH + HTTPS native, har CORS-konfig i app.ini,
och ger ett webb-UI för admin.

```bash
sudo apt install gitea
# eller: docker run gitea/gitea
```

Web-klient klonar via:
```
Repo: https://firma.se/anna/firma.git
Token: <gitea PAT>
```

## Steg 4 — Deploya AVA-webappen

Två val för var AVA-UI:t hostas:

### A. Samma server (Cleura)

```bash
# På Cleura-servern
git clone https://github.com/ulrik-s/ava /opt/ava
cd /opt/ava
yarn install
yarn build               # producerar .next/ för server-mode
# eller:
DEMO_BUILD=1 yarn build  # statisk export i out/

# Servera via samma nginx:
# location / { root /opt/ava/out; try_files $uri $uri/ /index.html; }
```

### B. Vercel / Cloudflare Pages

Pusha AVA-UI:t som ett vanligt Next.js-projekt. Sätt
`NEXT_PUBLIC_DEFAULT_REPO=https://firma.se/git/firma` så
landningssidan pekar direkt på rätt repo.

## Steg 5 — Klient-konfiguration

Användarna öppnar AVA-appen och går till **"Byt firma / datakälla"** →
**Tier 3: Self-hosted**:

| Fält | Värde |
|---|---|
| Tier | `3. Self-hosted (Cleura/Linux)` |
| Repo | `https://firma.se/git/firma` |
| Auth-token | (htpasswd-lösenord eller Gitea PAT) |
| Organisation ID | `firma-x` |
| Namn | Anna Advokat |
| E-post | anna@firma.se |

**Spara & ladda om** → AVA klonar repo:t via web+FSA eller Tauri.

## Per-funktion-stöd

| Funktion | Tier 1 Demo | Tier 2 GitHub | Tier 3 Self-hosted |
|---|---|---|---|
| Läs publik data | ✅ | n/a | n/a |
| Läs privat data | n/a | ✅ med PAT | ✅ med htpasswd/PAT |
| Skriv från Tauri | n/a | ✅ via git_push | ✅ SSH eller HTTPS |
| Skriv från Web+FSA | n/a | ✅ via isomorphic-git + token | ✅ med CORS-konfig på servern |
| Multi-user | n/a | ✅ via GitHub-konton | ✅ via egna konton |
| Offline backup | n/a | GitHub | Egen server + GitHub-spegling |
| Egen domän | n/a | n/a | ✅ firma.se |
| Datalokalitet | n/a | GitHub (US/EU) | ✅ Sverige (Cleura) |

## Verifiering

```bash
# 1. SSH-clone fungerar?
git clone git@firma.se:repos/firma.git /tmp/test-ssh
# Förväntat: clones into /tmp/test-ssh

# 2. HTTPS-clone med token?
git clone https://anna:TOKEN@firma.se/git/firma /tmp/test-https
# Förväntat: clones med basic auth

# 3. CORS-headers från web?
curl -I -H "Origin: https://ava.firma.se" https://firma.se/git/firma/info/refs?service=git-upload-pack
# Förväntat: Access-Control-Allow-Origin: https://ava.firma.se
```

## Säkerhet

- **SSH**: använd ed25519-nycklar, ssh-shell-restriction via authorized_keys
- **HTTPS**: enbart TLS 1.3, `auth_basic` eller bättre (OAuth2 proxy)
- **Tokens**: rotera per kvartal, lagra i Tauri keychain / browser localStorage
- **Backup**: cron-job som speglar `/home/git-firma/repos/` till GitHub varje natt
- **Audit**: `git log --pretty=format:"%h %an %ae %s"` visar full historik

## Migration mellan tiers

```
Tier 1 → Tier 2:
  AVA-app: byt repo i Settings → "user/repo" på GitHub
  Data: rensa OPFS-cache, klona från GitHub

Tier 2 → Tier 3:
  Servern: git clone --mirror git@github.com:user/repo /home/git-firma/repos/firma.git
  AVA-app: byt repo i Settings → "https://firma.se/git/firma"
  Data: rensa OPFS-cache, klona från egen server

Inga datakonverteringar behövs — git är samma format hela vägen.
```
