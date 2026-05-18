#!/usr/bin/env bash
# AVA local-first bootstrap.
#
# Engångskommando som en användare kör efter installation av AVA Tauri-appen
# för att sätta upp sin lokala klon. Förutsätter att:
#   - git är installerat
#   - SSH-nyckeln är genererad och uploadad till byråns server
#
# Användning:
#   bash scripts/bootstrap-local-first.sh \
#     --repo ssh://git@server/srv/git/firma-x.git \
#     --dir ~/Library/Application\ Support/AVA/firma-x \
#     [--user anna@firma.se]
#
# Vad scriptet gör:
#   1. Klonar (eller pullar) byrå-repo:t
#   2. Sätter upp sparse-checkout för senaste 12 månader
#   3. Genererar SQLite-schema + skapar tom DB
#   4. Verifierar grundförutsättningar (yarn, git, ssh)

set -euo pipefail

REPO=""
DIR=""
USER=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --repo) REPO="$2"; shift 2 ;;
    --dir)  DIR="$2"; shift 2 ;;
    --user) USER="$2"; shift 2 ;;
    *) echo "Okänt argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$REPO" || -z "$DIR" ]]; then
  echo "Användning: bash scripts/bootstrap-local-first.sh --repo <git-url> --dir <path> [--user <email>]" >&2
  exit 1
fi

# ── Förkrav ─────────────────────────────────────────────────────
echo "▶ Verifierar förkrav"
for cmd in git ssh yarn node; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "  ✗ Saknar '$cmd' — installera först." >&2
    exit 1
  fi
done
echo "  ✓ git, ssh, yarn, node"

# ── Clone (partial + sparse) ────────────────────────────────────
mkdir -p "$(dirname "$DIR")"
if [[ -d "$DIR/.git" ]]; then
  echo "▶ Repo redan klonad — pullar senaste"
  git -C "$DIR" fetch origin main
  git -C "$DIR" reset --hard origin/main
else
  echo "▶ Klonar $REPO (partial, sparse)"
  git clone --filter=blob:none --no-checkout "$REPO" "$DIR"
  git -C "$DIR" sparse-checkout init --cone
  YEAR=$(date +%Y)
  LAST_YEAR=$((YEAR - 1))
  git -C "$DIR" sparse-checkout set \
    "matters/active" \
    "matters/archive/$YEAR" \
    "matters/archive/$LAST_YEAR" \
    "events/$YEAR" \
    "events/$LAST_YEAR" \
    "claims/$YEAR" \
    "claims/$LAST_YEAR" \
    "contacts" \
    "documents" \
    "time-entries/$YEAR" \
    "time-entries/$LAST_YEAR" \
    ".ava"
  git -C "$DIR" checkout main
fi
echo "  ✓ Working tree i $DIR"

# ── Generera SQLite-schema + skapa tom DB ────────────────────
if [[ ! -f prisma/schema.sqlite.prisma ]]; then
  echo "▶ Genererar SQLite-schema"
  yarn schema:sqlite
fi

DB_FILE="$DIR/.ava/cache.db"
mkdir -p "$(dirname "$DB_FILE")"
if [[ ! -f "$DB_FILE" ]]; then
  echo "▶ Initierar SQLite-cache i $DB_FILE"
  DATABASE_URL="file:$DB_FILE" yarn prisma db push \
    --schema prisma/schema.sqlite.prisma \
    --accept-data-loss \
    --skip-generate
  echo "  ✓ SQLite-cache redo"
else
  echo "  • SQLite-cache redan finns"
fi

# ── Visa nästa steg ─────────────────────────────────────────────
echo ""
echo "✅ Bootstrap klar."
echo ""
echo "Nästa steg:"
echo "  • Sätt env-variabler i ~/.ava/config:"
echo "      AVA_REPO_DIR=\"$DIR\""
echo "      DATABASE_URL=\"file:$DB_FILE\""
[[ -n "$USER" ]] && echo "      AVA_USER=\"$USER\""
echo "  • Starta appen:  yarn tauri:dev   (utveckling)"
echo "                   yarn tauri:build (paketera)"
