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

echo "[server-first] startar: $BIN $*"
exec "$BIN" "$@"
