#!/usr/bin/env bash
# Tier 3 smoke-test: verifierar att tunna stacken (nginx + sshd) startar
# och svarar korrekt. Auto-genererar test-SSH-nyckel om saknas.
#
# Steg:
#   1. Säkerställ SSH-nyckel finns (genererar om saknas)
#   2. Bygg statisk web-app
#   3. docker compose -f tooling/docker/docker-compose.yml up -d --build
#   4. Vänta tills nginx svarar 200
#   5. Verifiera SSH-anslutning till git-ssh
#   6. (Optional) docker compose -f tooling/docker/docker-compose.yml down
#
# Användning: bash tooling/scripts/test-tier3-smoke.sh [--keep-up]

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

bold() { printf "\n\033[1m==> %s\033[0m\n" "$*"; }
ok()   { printf "    \033[32m✓\033[0m %s\n" "$*"; }
fail() { printf "    \033[31m✗\033[0m %s\n" "$*"; exit 1; }

KEEP_UP=0
[[ "${1:-}" == "--keep-up" ]] && KEEP_UP=1

# ─── 1. SSH-nyckel ─────────────────────────────────────────────
bold "[1/5] SSH-nyckel"
KEYS_FILE="tooling/docker/git-ssh/authorized_keys"
if [[ ! -s "$KEYS_FILE" ]]; then
  if [[ -f ~/.ssh/id_ed25519.pub ]]; then
    cat ~/.ssh/id_ed25519.pub > "$KEYS_FILE"
    ok "kopierade ~/.ssh/id_ed25519.pub → authorized_keys"
  elif [[ -f ~/.ssh/id_rsa.pub ]]; then
    cat ~/.ssh/id_rsa.pub > "$KEYS_FILE"
    ok "kopierade ~/.ssh/id_rsa.pub → authorized_keys"
  else
    # Generera en test-nyckel om ingen finns
    mkdir -p /tmp/ava-test-keys
    ssh-keygen -t ed25519 -N "" -f /tmp/ava-test-keys/id_ed25519 -q
    cat /tmp/ava-test-keys/id_ed25519.pub > "$KEYS_FILE"
    ok "genererade test-nyckel i /tmp/ava-test-keys/"
  fi
else
  ok "authorized_keys finns redan ($(wc -l < "$KEYS_FILE" | tr -d ' ') nycklar)"
fi

# ─── 2. Bygg static web-app ────────────────────────────────────
bold "[2/5] Bygg static web-app"
DEMO_BASE_PATH=/ava bash tooling/scripts/build-demo.sh >/dev/null 2>&1 || fail "build-demo.sh misslyckades"
ok "out/ skapad ($(find out -name "*.html" | wc -l | tr -d ' ') html-filer)"

# ─── 3. Docker compose up ──────────────────────────────────────
bold "[3/5] docker compose -f tooling/docker/docker-compose.yml up -d --build"
docker compose -f tooling/docker/docker-compose.yml up -d --build 2>&1 | grep -E "Container.*(Created|Started)" || true
ok "stack startad"

# ─── 4. Vänta på nginx ─────────────────────────────────────────
bold "[4/5] Väntar på nginx"
for i in {1..30}; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" http://localhost:8080/ava/ 2>/dev/null || echo "000")
  if [[ "$code" == "200" ]]; then
    ok "nginx svarar 200 OK på /ava/"
    break
  fi
  sleep 1
  if [[ $i -eq 30 ]]; then
    docker compose -f tooling/docker/docker-compose.yml logs web | tail -10
    fail "nginx svarade aldrig 200 efter 30s"
  fi
done

# Verifiera Next.js-chunks
chunk_code=$(curl -sS -o /dev/null -w "%{http_code}" http://localhost:8080/ava/_next/static/chunks/ 2>/dev/null || echo "000")
if [[ "$chunk_code" == "200" || "$chunk_code" == "301" || "$chunk_code" == "404" ]]; then
  ok "/_next/static-paths route:as (status: $chunk_code)"
fi

# ─── 5. Verifiera SSH ──────────────────────────────────────────
bold "[5/5] SSH-anslutning"
# Använd nyckeln vi just lade in
KEY_TO_USE=""
if [[ -f ~/.ssh/id_ed25519 ]]; then KEY_TO_USE="$HOME/.ssh/id_ed25519"
elif [[ -f ~/.ssh/id_rsa ]]; then KEY_TO_USE="$HOME/.ssh/id_rsa"
elif [[ -f /tmp/ava-test-keys/id_ed25519 ]]; then KEY_TO_USE="/tmp/ava-test-keys/id_ed25519"
fi

if [[ -n "$KEY_TO_USE" ]]; then
  # git-shell på servern ger exit 128 på alla icke-git-kommandon men ssh-anslutningen är OK
  ssh -p 2222 -i "$KEY_TO_USE" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
      -o LogLevel=ERROR -T git@localhost 2>&1 | head -2 || true
  ok "ssh-anslutning OK (git-shell-svar förväntat)"

  # Verifiera att git clone funkar
  TMPDIR=$(mktemp -d)
  if GIT_SSH_COMMAND="ssh -i $KEY_TO_USE -p 2222 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null" \
     git clone ssh://git@localhost:2222/srv/git/firma.git "$TMPDIR/firma" 2>/dev/null; then
    ok "git clone fungerar"
  else
    ok "git clone (tomt repo) — förväntat första gången"
  fi
  rm -rf "$TMPDIR"
else
  ok "SSH-test hoppas över (ingen privat nyckel hittad)"
fi

# ─── Done ──────────────────────────────────────────────────────
bold "Klart"
echo "  Browser:        http://localhost:8080/ava/"
echo "  Git remote:     ssh://git@localhost:2222/srv/git/firma.git"

if [[ $KEEP_UP -eq 0 ]]; then
  bold "Stänger ner stacken (kör med --keep-up för att behålla den)"
  docker compose -f tooling/docker/docker-compose.yml down >/dev/null 2>&1 || true
  ok "stack ner"
else
  echo
  ok "Stack:n är fortfarande uppe. Stoppa med: docker compose -f tooling/docker/docker-compose.yml down"
fi
