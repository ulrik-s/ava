# syntax=docker/dockerfile:1
#
# AVA server-first-runtime (#410, ADR 0016) — den Postgres-backade tRPC-over-HTTP-
# servern (server-verifierad principal ur oauth2-proxy-headers). Ersätter på sikt
# git-peer-server-runtimen (#421) i byråns stack.
#
# Tunn runtime-image: debian-slim + ca-certificates + den förbyggda standalone-
# binären (byggd utanför imagen, samma mönster som server-runtime):
#   bun run server-first:build      # → dist/server-first/ava-server-first-linux-*
#
# Migrationer bakas INTE in — kör `bun run db:migrate` mot Postgres före start
# (binären kan inte läsa migrations-SQL:en i runtime).
#
# Bygg (från repo-roten, så dist/ ligger i build-contexten):
#   docker build -f tooling/docker/server-first/Dockerfile -t ava-server-first .
FROM debian:stable-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY dist/server-first/ava-server-first-linux-x64   /opt/ava/bin/ava-server-first-linux-x64
COPY dist/server-first/ava-server-first-linux-arm64 /opt/ava/bin/ava-server-first-linux-arm64
COPY tooling/docker/server-first/entrypoint.sh      /entrypoint.sh
RUN chmod +x /opt/ava/bin/ava-server-first-linux-* /entrypoint.sh

# Loopback default (sitter bakom nginx/oauth2-proxy som TLS-terminerar + injicerar
# X-Auth-Request-*). Override:a AVA_HTTP_HOST=0.0.0.0 i docker-nätet.
ENV AVA_HTTP_HOST=0.0.0.0 \
    AVA_HTTP_PORT=3001

EXPOSE 3001
ENTRYPOINT ["/entrypoint.sh"]
