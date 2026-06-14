#!/usr/bin/env bash
#
# install-from-release.sh (#325) — ett-svep-installer för AVA-server.
#
# Hämtar AVA vid en GitHub-release-tagg och kör HELA install-flödet:
#   1. förutsättnings-koll (docker, bun, curl, tar)
#   2. ladda ner käll-tarballen för taggen (innehåller compose + install-server)
#   3. packa upp + `bun install --frozen-lockfile`
#   4. `install-server.ts --config <fil> --start` (valv + env + preflight +
#      docker up + tjänste-kontroller, #323)
#
# Käll-tarballen används eftersom compose-filerna + install-server-scriptet inte
# är fristående release-assets (binärerna/checksums är separata). En curerad
# server-bundle är en uppföljning (#325-avgränsning).
#
# Användning:
#   curl -fsSL <raw-url>/install-from-release.sh | bash -s -- \
#     --version v1.2.3 --config ./install.json --dir /srv/ava
#   # eller lokalt:
#   bash tooling/scripts/install-from-release.sh --version latest --config ./install.json
#
#   --version <tag|latest>   release-tagg (default: latest)
#   --config  <fil.json>     install-server-config (krävs; se --print-config-template)
#   --dir     <katalog>      install-katalog (default: ./ava-<tag>)
#   --repo    <owner/repo>   GitHub-repo (default: ulrik-s/ava)
#   --dry-run                skriv ut planen (tagg, URL:er, kommandon) utan att köra
#   --help                   denna hjälp

set -euo pipefail

REPO="ulrik-s/ava"
VERSION="latest"
CONFIG=""
DIR=""
DRY_RUN=0

log()  { printf '\033[1m[ava-install]\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[ava-install] FEL:\033[0m %s\n' "$*" >&2; exit 1; }

# Skriv ut hjälp-blocket (kommentarsraderna 2.. fram till `set -euo`). awk i
# st.f. `head -n -1` → portabelt (BSD/macOS-head saknar negativ -n).
usage() { awk 'NR>=2 { if ($0 ~ /^set -euo pipefail/) exit; sub(/^# ?/, ""); print }' "$0"; }

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --version) VERSION="${2:?--version kräver ett värde}"; shift 2 ;;
      --config)  CONFIG="${2:?--config kräver ett värde}"; shift 2 ;;
      --dir)     DIR="${2:?--dir kräver ett värde}"; shift 2 ;;
      --repo)    REPO="${2:?--repo kräver ett värde}"; shift 2 ;;
      --dry-run) DRY_RUN=1; shift ;;
      --help|-h) usage; exit 0 ;;
      *) die "okänt argument: $1 (kör --help)" ;;
    esac
  done
}

# Verktyg som krävs. I dry-run räcker curl (för ev. latest-uppslag); annars allt.
check_prereqs() {
  local missing=""
  local needed="curl tar"
  [ "$DRY_RUN" -eq 1 ] || needed="$needed docker bun"
  for bin in $needed; do
    command -v "$bin" >/dev/null 2>&1 || missing="$missing $bin"
  done
  [ -z "$missing" ] || die "saknar verktyg på PATH:$missing"
}

# "latest" → slå upp senaste tag_name via GitHub API (nät). Explicit tagg = no-op.
resolve_version() {
  [ "$VERSION" = "latest" ] || return 0
  log "slår upp senaste release för $REPO …"
  local api="https://api.github.com/repos/$REPO/releases/latest"
  VERSION="$(curl -fsSL "$api" | grep '"tag_name"' | head -1 | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')"
  [ -n "$VERSION" ] || die "kunde inte slå upp senaste tagg ($api)"
}

main() {
  parse_args "$@"
  [ -n "$CONFIG" ] || die "--config <fil.json> krävs (skapa en med: install-server.ts --print-config-template)"
  check_prereqs

  # latest-uppslag hoppas i dry-run med explicit tagg (håller dry-run nät-fri/testbar).
  if [ "$DRY_RUN" -eq 0 ] || [ "$VERSION" != "latest" ]; then resolve_version; fi
  [ -n "$DIR" ] || DIR="./ava-${VERSION}"

  local tarball_url="https://github.com/$REPO/archive/refs/tags/${VERSION}.tar.gz"
  local install_cmd="bun tooling/scripts/install-server.ts --config $CONFIG --start"

  if [ "$DRY_RUN" -eq 1 ]; then
    log "DRY-RUN — inget körs. Plan:"
    echo "  repo:       $REPO"
    echo "  version:    $VERSION"
    echo "  tarball:    $tarball_url"
    echo "  install-dir:$DIR"
    echo "  config:     $CONFIG"
    echo "  steg 1: curl -fsSL $tarball_url | tar -xz -C $DIR --strip-components=1"
    echo "  steg 2: (cd $DIR && bun install --frozen-lockfile)"
    echo "  steg 3: (cd $DIR && $install_cmd)"
    return 0
  fi

  [ -f "$CONFIG" ] || die "config-filen finns inte: $CONFIG"
  local config_abs; config_abs="$(cd "$(dirname "$CONFIG")" && pwd)/$(basename "$CONFIG")"

  log "hämtar $REPO@$VERSION → $DIR"
  mkdir -p "$DIR"
  curl -fsSL "$tarball_url" | tar -xz -C "$DIR" --strip-components=1

  log "installerar beroenden (bun install) …"
  ( cd "$DIR" && bun install --frozen-lockfile )

  log "kör install-server (valv + env + preflight + docker up + tjänste-checks) …"
  ( cd "$DIR" && bun tooling/scripts/install-server.ts --config "$config_abs" --start )

  log "klart. AVA-server installerad från $REPO@$VERSION i $DIR."
}

main "$@"
