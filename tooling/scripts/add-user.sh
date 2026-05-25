#!/usr/bin/env bash
#
# `add-user.sh` — lägg till en användare i AVA:s self-hosted auth.
#
# Användning:
#     tooling/scripts/add-user.sh <email>                  # genererar slumpad PAT
#     tooling/scripts/add-user.sh <email> <given-pat>      # eller använd egen PAT
#
# Körs på admins lokala maskin om docker-stacken kör lokalt, eller via
# SSH om den kör på en remote-server:
#     ssh admin@firma-server 'cd /opt/ava && tooling/scripts/add-user.sh anna@firma.se'
#
# Vad det gör:
#   1. Hämtar web-containerns namn (sätt CONTAINER=... för att override:a)
#   2. Kör `htpasswd -bB` i containern → uppdaterar /auth-data/htpasswd
#   3. Printar email + PAT — admin skickar dessa offline (Signal, SMS, in person)
#      till den nya användaren som klistrar in dem i AVA:s /setup-sida
#
# Ingen extern tjänst, ingen e-post, ingen databas — bara docker exec.

set -euo pipefail

EMAIL=${1:?Användning: $0 <email> [given-pat]}
GIVEN_PAT=${2:-}
CONTAINER=${CONTAINER:-ava-web-1}

if [[ -z "$GIVEN_PAT" ]]; then
  PAT=$(openssl rand -base64 32 | tr -d '=+/' | head -c 40)
else
  PAT="$GIVEN_PAT"
fi

if ! docker exec "$CONTAINER" test -f /auth-data/htpasswd 2>/dev/null; then
  echo "ERROR: ingen htpasswd i $CONTAINER. Är docker-stacken igång?" >&2
  echo "       (Starta med: docker compose -f tooling/docker/docker-compose.yml up -d)" >&2
  exit 1
fi

docker exec "$CONTAINER" htpasswd -bB /auth-data/htpasswd "$EMAIL" "$PAT" 2>&1 | grep -v "Adding password" || true

cat <<EOF

✓ Användare tillagd i AVA-auth (htpasswd).

  Email:  $EMAIL
  PAT:    $PAT

Användaren öppnar AVA-app:ens /setup och klistrar in detta. PAT:n
sparas i deras browser-localStorage och skickas som Basic-auth-password
till /git/-endpointen. Skicka uppgifterna via en säker kanal
(Signal/SMS/i person) — INTE okrypterad e-post.

Vid behov av att rotera PAT:n: kör samma kommando igen, eller använd
egen PAT som andra argument.

EOF
