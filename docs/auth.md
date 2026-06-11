# AVA — Autentisering (self-hosted)

Denna fil beskriver hur autentisering fungerar för AVA:s **self-hosted**-läge
(docker på Linux). Demo-läget på GitHub Pages är read-only och har ingen auth.

> **Beslutad riktning ([ADR 0009](./adr/0009-oidc-login-via-servern.md), epic
> [#221](https://github.com/ulrik-s/ava/issues/221)):** människo-login flyttar
> till **OIDC** — AVA blir en *relying party* (bring-your-own-IdP: Entra
> ID/Google/BankID-broker), enforce:at av `oauth2-proxy` i nginx-fronten, med
> användar-allowlist i firma.git. Designmålet "ingen extern IdP" nedan revideras
> då till **delegerad identitet (ej data)** — data lämnar aldrig firma.git — med
> self-hosted IdP (Authelia) som tillval. Dokumentet nedan beskriver den
> **nuvarande** htpasswd/PAT-modellen tills epiken landar; maskin-/CLI-klienter
> (server-runtime, `git clone`) behåller PAT/deploy-key även efteråt.

## OIDC-läge (#222, opt-in) — oauth2-proxy

OIDC-inloggning aktiveras med en compose-overlay (default-stacken är oförändrad):

```bash
docker compose -f tooling/docker/docker-compose.yml \
               -f tooling/docker/docker-compose.oidc.yml up -d --build
```

**Komponenter:**

- `nginx-oidc.conf` — nginx gat:ar appen + `/git/` med `auth_request` →
  `oauth2-proxy`. 401 → `/oauth2/start` (OIDC-inloggning). Eftersom appen och
  `/git/` är samma origin följer oauth2-proxy-cookien automatiskt med iso-gits
  `fetch` → git-push/pull funkar utan klient-token-kod.
- `oauth2-proxy` — OIDC relying party. Pekas mot byråns IdP via
  `OAUTH2_PROXY_OIDC_ISSUER_URL` + `CLIENT_ID`/`CLIENT_SECRET`; cookie-secret
  ur secrets-valvet (#79). `mock-oidc`-tjänsten i overlayen är **endast dev**
  (navikt/mock-oauth2-server) — ta bort den i drift och peka issuer mot Entra
  ID/Google/BankID-broker.
- **Klient-bryggan:** appen hämtar inloggad email från `/oauth2/userinfo`
  (`src/lib/client/auth/oidc-principal.ts`) och auktoriserar mot
  användar-allowlisten i firma.git via `OidcAuthProvider` (#223). Okänd email
  nekas (autentisering ≠ auktorisering).

**Skarp drift (env, ur valvet):**

```
OAUTH2_PROXY_OIDC_ISSUER_URL=https://login.microsoftonline.com/<tenant>/v2.0
OAUTH2_PROXY_CLIENT_ID=<app-reg-client-id>
OAUTH2_PROXY_CLIENT_SECRET=<ur valvet #79>
OAUTH2_PROXY_COOKIE_SECRET=<32 byte, ur valvet>
OAUTH2_PROXY_REDIRECT_URL=https://<din-host>/oauth2/callback
```

**CLI/maskin (icke-browser):** behåller Basic-auth/PAT — sätt
`OAUTH2_PROXY_HTPASSWD_FILE=/auth-data/htpasswd` så oauth2-proxy accepterar
både OIDC-cookie och PAT på `/git/`. server-runtime (#81) använder PAT/deploy-key.

**Verifiering:** `bun run oidc:smoke` startar stacken (på port 8088) mot
mock-OIDC och verifierar wiringen strukturellt (auth_request → oauth2-proxy →
discovery → authorize-redirect). Hela token-dansen valideras mot din riktiga
IdP (browser-inloggning).

## Designmål

- **Tunn server**: ingen custom auth-tjänst, inga long-running processer
- **Svensk data-suveränitet**: ingen extern IdP, ingen tredje-parts proxy
- **Browser-kompatibel**: webb-klienten (isomorphic-git) måste kunna pusha
- **Identifierbar**: varje commit ska gå att knyta till en specifik advokat

## Vad som faktiskt körs

Server-sidan består av (i default-läget):

1. **nginx** (1.27-alpine, vanilla — ingen lua, ingen custom modul)
2. **`git-http-backend`** (binär ur git-paketet)
3. **`fcgiwrap`** (CGI-bridge)
4. **`sshd`** (för git+ssh-access)
5. **`htpasswd`** + **`openssl`** (binärer från `apache2-utils`)
6. **15 rader bash i entrypoint**: bootstrappar admin-PAT vid första uppstart

Ingen custom Node-tjänst körs i default-stacken.

## Auth-grinden (nginx)

`tooling/docker/nginx.conf` sätter `auth_basic` på `/git/`:

```nginx
location ~ ^/git(/.*)?$ {
  auth_basic "AVA";
  auth_basic_user_file /auth-data/htpasswd;
  # ...fastcgi_pass till git-http-backend...
}
```

`/auth-data/htpasswd` mountas via en docker-volym (`auth_data`) som är
skrivbar av web-containerns entrypoint + admin (via `docker exec`).

## Bootstrap (första uppstart)

`tooling/docker/web/entrypoint.sh` kör:

```bash
if [ ! -s /auth-data/htpasswd ]; then
  ADMIN_PAT=$(openssl rand -base64 32 | tr -d '=+/' | head -c 40)
  htpasswd -bBc /auth-data/htpasswd admin "$ADMIN_PAT"
  echo "Admin-token: $ADMIN_PAT"   # printas EN GÅNG i loggen
fi
```

Admin kör då:

```bash
docker compose -f tooling/docker/docker-compose.yml up -d
docker compose logs web | grep "Admin-token"
```

Kopierar token:n och öppnar `http://<server>/ava/setup` → klistrar in.
Token:n persisteras i browserns `localStorage` (`ava.firma.token`) och
skickas som Basic-auth-password mot `/git/`.

## Lägg till fler användare

```bash
tooling/scripts/add-user.sh anna@firma.se
# → printar email + ny slumpad PAT
```

Scriptet är ~15 rader bash som kör `docker exec ava-web-1 htpasswd -bB ...`.

Admin skickar PAT + email till den nya användaren **via säker kanal**
(Signal, SMS, i person — INTE okrypterad e-post). Användaren öppnar
`/setup` i sin browser och klistrar in.

## Rotera PAT

```bash
tooling/scripts/add-user.sh anna@firma.se          # ny slumpad PAT
# eller
tooling/scripts/add-user.sh anna@firma.se <ny-pat> # admin-vald PAT
```

Existerande hash skrivs över. Anna måste klistra in den nya i `/setup`
nästa gång hon kör.

## Ta bort användare

```bash
docker exec ava-web-1 htpasswd -D /auth-data/htpasswd anna@firma.se
```

Befintliga browser-sessioner får 401 vid nästa pull/push och tvingas
till `/setup`.

## Commit-attribution

Network-auth (htpasswd) verifierar bara att klienten har en giltig PAT —
inte vem den klienten "är". Identitet binds till commits via SSH-signering:

1. Browser genererar ett Ed25519-keypar vid första körningen (persisteras i `IndexedDB`)
2. Public key registreras på user-raden (`.ava/users/<email>.json`, fältet `publicKeys`)
3. Varje commit signeras med private key i SSH-format (`gpgsig`-fältet i commit-objektet)
4. En git pre-receive hook (manuellt installerad om man vill enforce) kan verifiera att signeringsnyckeln matchar en av de registrerade nycklarna för den claimade authorn

I default-läget signeras commits men signaturen verifieras inte server-side.
Det är opt-in via en hook i `firma.git/hooks/pre-receive`.

## Säkerhetsbudget

| Hot | Skydd |
|---|---|
| Anonym läsning av git-data | `auth_basic` → 401 |
| Anonym push | Samma — `auth_basic` skyddar `git-receive-pack` |
| Spoofad commit-author | SSH-signatur verifieras (om hook installerad) |
| Stulen PAT | Rotera via `add-user.sh` |
| Network sniffing | Sätt upp HTTPS framför docker (Caddy/nginx-reverse-proxy med Let's Encrypt). Out-of-scope för dessa docs. |

## Vad om jag vill ha invite-flöde via UI istället för SSH?

Det finns en **valbar** docker-compose profil `invite-server` som lägger
till en tunn Node-tjänst (`tooling/docker/auth-server/`) som utfärdar
PATs via bootstrap-secret + invite-tokens. Default OFF.

```bash
docker compose -f tooling/docker/docker-compose.yml --profile invite-server up -d
```

Då exponeras `/auth/`-endpoints i nginx och `/setup`-sidan visar avancerade
flöden bredvid "klistra in PAT". Se `tooling/docker/auth-server/server.mjs`.

Men detta är **inte** rekommenderat för USP:n "din data, du bestämmer" —
varje server-process är drift för kunden. Default-läget med htpasswd +
admin-SSH har inga sådana processer.

## Vad om jag vill ha O365/BankID?

Inte default. Båda kräver extern IdP-tjänst eller server-side integration
som bryter "din data, du bestämmer"-modellen. När en kund explicit
efterfrågar det kan en valbar profil tillkomma — t.ex. egen BankID
RP-cert + en liten Node-tjänst som signerar PATs efter BankID-auth.
Implementerat per-kund, inte standard.
