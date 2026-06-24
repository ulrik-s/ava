#!/usr/bin/env bash
# Entrypoint för server-first-containern (#410, ADR 0016).
#
#   1. Välj rätt binär för arkitekturen (multi-arch image).
#   2. Exec:a den — config läses ur env (AVA_DATABASE_URL, AVA_ORGANIZATION_ID,
#      AVA_HTTP_PORT, AVA_HTTP_HOST). Inga hemligheter bakas in.
#
# Migrationer körs INTE här — applicera schemat med `bun run db:migrate` mot
# AVA_DATABASE_URL innan containern startar (binären bär ingen migrations-SQL).
set -euo pipefail

case "$(uname -m)" in
  x86_64)  BIN=/opt/ava/bin/ava-server-first-linux-x64 ;;
  aarch64) BIN=/opt/ava/bin/ava-server-first-linux-arm64 ;;
  *) echo "[server-first] okänd arkitektur: $(uname -m)" >&2; exit 1 ;;
esac

# git ≥2.35 vägrar operera i ett repo som ägs av en ANNAN uid än processen
# ("detected dubious ownership"). När AVA_CONTENT_DIR är en host-bind-mount
# (self-hosted-operatörer + selfhosted-local-stacken) ägs den av host-uid:t,
# inte containerns → GitContentStore:s `git add`/commit i uploadContent kraschar.
# Markera content-dir:en som betrodd (containern är enkel-tenant; repot där är
# det enda). En named volume träffar inte detta, varför server-first-e2e:t
# (named volume) missade buggen men selfhosted-local (bind-mount) träffar den.
git config --global --add safe.directory "${AVA_CONTENT_DIR:-/data/content}" || true

echo "[server-first] startar: $BIN $*"
exec "$BIN" "$@"
