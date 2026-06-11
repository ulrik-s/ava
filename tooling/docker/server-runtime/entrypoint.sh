#!/usr/bin/env bash
# Entrypoint för server-runtime-containern (#81, ADR 0005).
#
#   1. Välj rätt binär för arkitekturen (multi-arch image).
#   2. Sätt git-identitet (commit-författare) + safe.directory.
#   3. Konfigurera git-auth mot firma.git ur env:
#        - HTTP-basic:  AVA_SR_GIT_USER + AVA_SR_GIT_TOKEN (htpasswd-användare/PAT)
#        - SSH:         AVA_SR_SSH_KEY_FILE (monterad privat deploy-key)
#      file://-repos (lokal drift/röktest) behöver ingen auth.
#   4. Exec:a binären och vidarebefordra argv (t.ex. --once).
#
# Inga hemligheter bakas in i imagen — de injiceras vid körning (env/mount).
set -euo pipefail

export HOME=/root

# ── 1. Arkitektur → binär ───────────────────────────────────────────────
case "$(uname -m)" in
  x86_64)  BIN=/opt/ava/bin/ava-server-runtime-linux-x64 ;;
  aarch64) BIN=/opt/ava/bin/ava-server-runtime-linux-arm64 ;;
  *) echo "[server-runtime] okänd arkitektur: $(uname -m)" >&2; exit 1 ;;
esac

# ── 2. Git-identitet + dubious-ownership-guard ──────────────────────────
git config --global --add safe.directory '*'
git config --global user.name  "${AVA_SR_PRINCIPAL_NAME:-AVA Server-runtime}"
git config --global user.email "${AVA_SR_PRINCIPAL_EMAIL:-server-runtime@ava.local}"

# ── 3. Git-auth ─────────────────────────────────────────────────────────
# HTTP-basic mot nginx /git/ (htpasswd). Creds-filen skyddas 600 (umask 077).
if [[ -n "${AVA_SR_GIT_USER:-}" && -n "${AVA_SR_GIT_TOKEN:-}" ]]; then
  url="${AVA_SR_REPO_URL:?AVA_SR_REPO_URL saknas (krävs för HTTP-basic-auth)}"
  scheme="$(printf '%s' "$url" | sed -E 's#^(https?)://.*#\1#')"
  host="$(printf '%s' "$url" | sed -E 's#^https?://([^/]+)/.*#\1#')"
  git config --global credential.helper store
  ( umask 077; printf '%s://%s:%s@%s\n' "$scheme" "$AVA_SR_GIT_USER" "$AVA_SR_GIT_TOKEN" "$host" > "$HOME/.git-credentials" )
  echo "[server-runtime] git-auth: HTTP-basic som '$AVA_SR_GIT_USER' mot $host"
fi

# SSH-deploy-key (alternativ till HTTP-basic; ssh://-remotes).
if [[ -n "${AVA_SR_SSH_KEY_FILE:-}" ]]; then
  mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"
  export GIT_SSH_COMMAND="ssh -i ${AVA_SR_SSH_KEY_FILE} -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${HOME}/.ssh/known_hosts"
  echo "[server-runtime] git-auth: SSH-deploy-key ${AVA_SR_SSH_KEY_FILE}"
fi

# ── 4. Kör ──────────────────────────────────────────────────────────────
echo "[server-runtime] startar: $BIN $*"
exec "$BIN" "$@"
