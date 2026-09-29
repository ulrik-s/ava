# shellcheck shell=bash
#
# Vänta in en engångs-Postgres i docker (#1305). Används av backup-verify.sh.
#
#   wait_for_pg <container> <försök> [paus-sekunder]   → 0 när servern är uppe
#
# Postgres-imagen kör först en tillfällig server för initdb och startar sedan
# om; pg_isready svarar redan under init-fasen, så init måste vara KLAR.
#
# Två kapplöpningar fällde CI ("engångs-Postgres startade inte" efter 1,2 s):
# - Slutkontrollen körde kontrollen en gång till utan omförsök — en server som
#   just svarat kunde vara mitt i omstarten. Resultatet sparas nu i stället.
# - `docker logs | grep -q` under `pipefail`: grep -q avslutar vid första
#   träffen, docker logs får SIGPIPE, och pipelinen blir falsk fast raden
#   fanns. grep läser nu hela loggen (utdata till /dev/null).

pg_init_done() {
  docker logs "$1" 2>&1 | grep "init process complete" >/dev/null
}

pg_accepts() {
  docker exec "$1" pg_isready -U ava -d ava >/dev/null 2>&1
}

wait_for_pg() {
  local container="$1" tries="$2" pause="${3:-1}"
  for _ in $(seq 1 "$tries"); do
    if pg_init_done "$container" && pg_accepts "$container"; then return 0; fi
    sleep "$pause"
  done
  return 1
}
