#!/bin/sh
# Entrypoint för web-containern: startar fcgiwrap (för git-http-backend)
# och sedan nginx i foreground.
#
# Bare-repot delas med git-ssh-servicen via den namngivna volymen
# `git_repos` (mountad på /srv/git i båda containrarna). Vi säkerställer
# att default-repot finns och tillåter HTTP-push.
set -eu

REPO_ROOT=/srv/git
DEFAULT_REPO="$REPO_ROOT/firma.git"

mkdir -p "$REPO_ROOT"

# Bare-repot kan ha skapats av git-ssh-containern som uid 1000. Vi (och
# git-http-backend-CGI:t) körs som root, så git's "dubious ownership"-
# guard skulle annars vägra med "not in a git directory". safe.directory=*
# i root:s globala config gäller även fcgiwrap-processen (samma HOME).
export HOME=/root
git config --global --add safe.directory '*'

# Skapa default-repot om det inte finns (idempotent — git-ssh kan redan
# ha skapat det via sin egen entrypoint).
if [ ! -d "$DEFAULT_REPO" ]; then
  echo "[web] Skapar default-repo $DEFAULT_REPO…"
  git init --bare -b main "$DEFAULT_REPO"
fi

# Default-branch = main (appen klonar/pushar main). Äldre git defaultar
# till master vid init; korrigera HEAD så länge repot är tomt (inga
# heads ännu). Gör inget om main redan har commits.
if ! git -C "$DEFAULT_REPO" show-ref --heads -q; then
  git -C "$DEFAULT_REPO" symbolic-ref HEAD refs/heads/main
fi

# Tillåt anonym push över smart-HTTP (lokal test-server). I prod-Tier3
# sker push över SSH; HTTP-push är bara för round-trip + self-hosted
# utan auth-lager framför.
git -C "$DEFAULT_REPO" config http.receivepack true
# Tillåt push till incheckad branch i bare-repo (bare har ingen working
# tree, men detta tystar varningar på vissa git-versioner).
git -C "$DEFAULT_REPO" config receive.denyCurrentBranch ignore

# fcgiwrap (och därmed git-http-backend) körs som root här och behöver
# läs/skriv på repot. uid:t kan skilja sig från git-ssh-containerns
# `git`-user, så vi öppnar rättigheterna. OK eftersom detta är lokal
# test-/self-hosted-infra utan multi-tenant på HTTP-lagret.
chmod -R a+rwX "$REPO_ROOT" 2>/dev/null || true

# Starta fcgiwrap på en unix-socket som nginx fastcgi_pass:ar till.
spawn-fcgi -s /var/run/fcgiwrap.socket -F 1 -- /usr/bin/fcgiwrap
chmod 666 /var/run/fcgiwrap.socket

# ─── Auth-bootstrap (engångs) ──────────────────────────────────────────
# Om /auth-data/htpasswd är tom vid första uppstart: skapa en slumpad
# admin-PAT, skriv htpasswd-entry för `admin`, och PRINTA token:n EN GÅNG
# i loggen så administratören kan klistra in den i AVA-app:ens /setup.
#
# Det här är all server-side auth-kod som finns: ~15 rader bash + de
# två binärerna `htpasswd` och `openssl` som följer med apk-paketen.
# Inga custom-tjänster att underhålla.
AUTH_DIR=/auth-data
mkdir -p "$AUTH_DIR"
HTPASSWD="$AUTH_DIR/htpasswd"
if [ ! -s "$HTPASSWD" ]; then
  ADMIN_PAT=$(openssl rand -base64 32 | tr -d '=+/' | head -c 40)
  htpasswd -bBc "$HTPASSWD" admin "$ADMIN_PAT"
  cat <<EOF >&2

[web] ────────────────────────────────────────────────────────────
[web]  AUTH BOOTSTRAP — första uppstart, ingen htpasswd fanns.
[web]
[web]    Admin-användare:  admin
[web]    Admin-token:      $ADMIN_PAT
[web]
[web]  Spara denna token — den visas BARA EN GÅNG. Använd den i
[web]  AVA-app:ens /setup-sida för att logga in.
[web]
[web]  Skapa fler användare med:
[web]    tooling/scripts/add-user.sh <email>
[web] ────────────────────────────────────────────────────────────

EOF
else
  echo "[web] Auth: $(wc -l < "$HTPASSWD") användare i htpasswd."
fi

echo "[web] git smart-HTTP redo på /git/  (repos under $REPO_ROOT)"
echo "[web] Startar nginx…"
exec nginx -g 'daemon off;'
