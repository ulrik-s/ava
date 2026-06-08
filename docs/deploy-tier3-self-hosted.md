# Deploy: self-hosted Linux + docker

Hur en byrå går från demo-läget till egen server. Två containers, en
volym, en bash-script. Inget custom server-kod-skikt att underhålla.

## Arkitektur

```
┌──────────────────────────────────────────────────────────────┐
│  Linux-server (1 GB RAM räcker)                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  docker compose                                        │  │
│  │  ┌──────────────────┐    ┌──────────────────┐          │  │
│  │  │ web              │    │ git-ssh          │          │  │
│  │  │ ├─ nginx          │    │ └─ sshd          │          │  │
│  │  │ ├─ git-http-bk   │    │                  │          │  │
│  │  │ ├─ fcgiwrap      │    │                  │          │  │
│  │  │ └─ htpasswd bin  │    │                  │          │  │
│  │  └────────┬─────────┘    └────────┬─────────┘          │  │
│  │           │ git_repos volume      │                    │  │
│  │           └────────────┬──────────┘                    │  │
│  │                        ▼                               │  │
│  │              /srv/git/firma.git (bare)                 │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
   ▲ HTTPS (auth_basic)                ▲ SSH (authorized_keys)
   │                                    │
Browser-klient (advokater)           CLI / Tauri (admin)
```

Två containers, en namngiven volym för git-repot, en namngiven volym för
htpasswd-filen. Det är allt.

## Installation

### 1. Servern (Ubuntu/Debian/Fedora — vad som helst med docker)

```bash
ssh admin@firma-server
sudo apt install docker.io docker-compose-v2 git
git clone https://github.com/<owner>/ava.git /opt/ava
cd /opt/ava
bun run install
DEMO_BASE_PATH=/ava bash tooling/scripts/build-demo.sh   # bygger out/
```

### 2. Starta stack

```bash
docker compose -f tooling/docker/docker-compose.yml up -d --build
```

Web-containerns entrypoint detekterar att htpasswd är tom och genererar en
slumpad admin-PAT. Den printas EN GÅNG i loggen:

```bash
docker compose -f tooling/docker/docker-compose.yml logs web

# [web] ────────────────────────────────────────────────────────────
# [web]  AUTH BOOTSTRAP — första uppstart, ingen htpasswd fanns.
# [web]
# [web]    Admin-användare:  admin
# [web]    Admin-token:      xkJ8mQ...
# [web]
# [web]  Spara denna token — den visas BARA EN GÅNG.
# [web] ────────────────────────────────────────────────────────────
```

**Kopiera token:n NU.** Den finns inte sparad någon annanstans.

### 3. Lägg upp HTTPS-terminering (rekommenderat)

Caddy är enklast — placera framför nginx:

```caddy
firma.se {
  reverse_proxy localhost:8080
}
```

Eller använd nginx-proxy + Let's Encrypt. AVA gör inga antaganden om
TLS-lagret.

### 4. Provisionera advokaterna

För varje advokat:

```bash
ssh admin@firma-server 'cd /opt/ava && tooling/scripts/add-user.sh anna@firma.se'
# → printar email + slumpad PAT
```

Admin skickar email + PAT till advokaten **via säker kanal** (Signal, SMS,
i person — INTE okrypterad e-post).

Advokaten öppnar `https://firma.se/ava/setup` → klistrar in PAT + email →
PAT sparas i browserns `localStorage` och skickas som Basic-auth mot
`/git/firma.git`.

### 5. Seed-data (valbart)

Om byrån vill börja med en rik demo-datamängd:

```bash
# Lokalt mot servern
SEED_REPO_URL=https://firma.se/git/firma.git bun run seed:local
# Kräver att din `git`-CLI har auth-credentials sparade för repo:t.
```

## Drift

### Backup

```bash
# Hela git-repot + htpasswd
docker run --rm -v ava_git_repos:/repos -v ava_auth_data:/auth \
  -v /backup:/out alpine tar czf /out/ava-$(date +%F).tar.gz /repos /auth
```

Återställ:

```bash
docker compose down
docker volume rm ava_git_repos ava_auth_data
docker run --rm -v ava_git_repos:/repos -v ava_auth_data:/auth \
  -v /backup:/in alpine tar xzf /in/ava-2026-05-25.tar.gz -C /
docker compose up -d
```

### Rotera advokats PAT

```bash
tooling/scripts/add-user.sh anna@firma.se          # ny slumpad
tooling/scripts/add-user.sh anna@firma.se <ny-pat> # vald
```

### Ta bort advokat

```bash
docker exec ava-web-1 htpasswd -D /auth-data/htpasswd anna@firma.se
```

### Uppdatera AVA-appen

```bash
cd /opt/ava
git pull
bun run install
DEMO_BASE_PATH=/ava bash tooling/scripts/build-demo.sh
docker compose -f tooling/docker/docker-compose.yml restart web
```

(Git-repot och htpasswd bevaras — volymerna är `git_repos` resp. `auth_data`.)

## Loggar + observability

```bash
docker compose -f tooling/docker/docker-compose.yml logs -f
# Watch:a auth-status:
watch 'docker exec ava-web-1 wc -l /auth-data/htpasswd'
```

Ingen Prometheus, ingen ELK — bara stdout. Skala upp om byrån behöver.

## Vad servern INTE kör

- Ingen Node.js-process
- Ingen databas
- Ingen auth-server (default)
- Ingen LLM (den körs i browsern hos varje advokat)
- Inga cron-jobb
- Ingen e-postserver
- Ingen reverse-proxy om du inte väljer att lägga till TLS

Allt är två standard-binärer (`nginx`, `sshd`) + några vanliga utility-tools
(`git-http-backend`, `fcgiwrap`, `htpasswd`). Varje rad bash som körs vid
uppstart syns i `tooling/docker/web/entrypoint.sh` (~70 rader).

## Vad om jag vill ha invite-UI istället för admin-SSH?

```bash
docker compose -f tooling/docker/docker-compose.yml --profile invite-server up -d
```

Lägger till en valbar Node-tjänst som exponerar `/auth/`-endpoints i
nginx för bootstrap + invite-token-flöde. Default OFF eftersom det är
en custom-process att underhålla. Se `tooling/docker/auth-server/` för
implementationen om du väljer den vägen.
