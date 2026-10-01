# shellcheck shell=bash
#
# Klient-releaser för produktions-deployen (#1369). Används av deploy-prod.sh.
#
#   releases/
#     20261001T130000Z-16e81735/    en färdigbyggd, KONTROLLERAD klient
#     20260930T090000Z-8dc303d5/    förra releasen (behålls för rollback)
#     current  -> 20261001T130000Z-16e81735    det Caddy serverar
#     previous -> 20260930T090000Z-8dc303d5    dit --rollback byter
#
# Varför inte out/ direkt: `next build` ERSÄTTER out/ (ny katalog, ny inode).
# Caddy bind-monterade out/ — en mount pekar på inoden, så under bygget
# serverade prod en halvskriven eller tom katalog (404), och ett bygge som
# sedan föll i en kontroll låg ändå ute (ny klient mot gammal server).
#
# Nu monterar Caddy hela releases/ och har `root /srv/releases/current`.
# Symlänken följs vid VARJE request, så ett byte är ett enda rename(2):
# atomärt, utan omstart och utan inaktuell mount. Länkarna är relativa — de
# ska fungera även inne i containern, där katalogen heter något annat.
#
# Funktionerna utgår från att arbetskatalogen är repo-roten (RELEASES_DIR är
# relativ) och returnerar ≠ 0 i stället för att avsluta — anroparen bestämmer.

RELEASES_DIR="${RELEASES_DIR:-releases}"

# Vart en länk pekar ("" om den saknas).
_release_target() { readlink "$RELEASES_DIR/$1" 2>/dev/null || true; }
release_current() { _release_target current; }
release_previous() { _release_target previous; }

# Ett ledigt namn för en ny release: <UTC-tid>-<etikett>[.n], där etiketten är
# den korta sha:n — eller "bootstrap" för en out/ av okänd version.
release_new_name() {
  local base name n=1
  base="$(date -u +%Y%m%dT%H%M%SZ)-$1"
  name="$base"
  while [ -e "$RELEASES_DIR/$name" ]; do
    n=$((n + 1))
    name="$base.$n"
  done
  printf '%s\n' "$name"
}

# rename(2) av en symlänk över en annan, utan att följa den gamla (GNU: -T,
# BSD/macOS: -h). Att bara skriva `ln -sfn` är unlink + symlink — ett glapp.
_release_rename() { mv -T "$1" "$2" 2>/dev/null || mv -h "$1" "$2"; }

# Peka <länk> på <mål> atomärt: ny länk bredvid, sedan rename över den gamla.
_release_link() {
  local tmp="$RELEASES_DIR/.$1.tmp"
  rm -f "$tmp"
  ln -s "$2" "$tmp"
  _release_rename "$tmp" "$RELEASES_DIR/$1"
}

# release_stage <byggkatalog> <namn> — flytta ett kontrollerat bygge till
# releases/<namn>. Releasen är INTE aktiv efteråt.
release_stage() {
  local src="$1" name="$2"
  [ -d "$src" ] || { echo "release_stage: $src finns inte" >&2; return 1; }
  [ ! -e "$RELEASES_DIR/$name" ] || { echo "release_stage: $RELEASES_DIR/$name finns redan" >&2; return 1; }
  mkdir -p "$RELEASES_DIR"
  mv "$src" "$RELEASES_DIR/$name"
}

# release_activate <namn> — gör <namn> till current; nuvarande blir previous.
# previous sätts FÖRST: avbryts bytet mellan stegen pekar båda på den gamla
# releasen, vilket är ofarligt (och prune raderar inget som används).
release_activate() {
  local name="$1" cur
  [ -d "$RELEASES_DIR/$name" ] || { echo "release_activate: $RELEASES_DIR/$name finns inte" >&2; return 1; }
  cur="$(release_current)"
  [ "$cur" != "$name" ] || return 0
  if [ -n "$cur" ]; then _release_link previous "$cur"; fi
  _release_link current "$name"
}

# release_rollback — byt tillbaka till previous (och gör nuvarande till previous,
# så att en andra rollback ångrar den första).
release_rollback() {
  local cur prev
  cur="$(release_current)"
  prev="$(release_previous)"
  [ -n "$prev" ] && [ -d "$RELEASES_DIR/$prev" ] || { echo "release_rollback: ingen tidigare release att byta till" >&2; return 1; }
  if [ -n "$cur" ]; then _release_link previous "$cur"; fi
  _release_link current "$prev"
}

# release_prune — radera allt utom current och previous (och länkarna själva).
release_prune() {
  local cur prev entry name
  cur="$(release_current)"
  prev="$(release_previous)"
  for entry in "$RELEASES_DIR"/*; do
    [ -d "$entry" ] && [ ! -L "$entry" ] || continue
    name="${entry##*/}"
    [ "$name" = "$cur" ] || [ "$name" = "$prev" ] || rm -rf "$entry"
  done
}

# release_describe — en rad för loggen / felrapporten.
release_describe() {
  local cur prev
  cur="$(release_current)"
  prev="$(release_previous)"
  printf 'releases/current -> %s (previous -> %s)\n' "${cur:-ingen}" "${prev:-ingen}"
}
