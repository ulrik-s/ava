# syntax=docker/dockerfile:1
#
# AVA server-runtime (#81, ADR 0005) — git-peer-tjänsten i byråns EGEN stack.
#
# Tunn runtime-image: debian-slim + git + ca-certificates + openssh-client och
# den förbyggda standalone-binären. Binären byggs UTANFÖR imagen med
#   bun run server-runtime:build      # → dist/server-runtime/ava-server-runtime-linux-*
# (samma binär som release-pipelinen #87 publicerar). Så slipper vi köra en
# tung monorepo-`bun install` i docker; imagen bär bara det den behöver.
#
# Bygg (från repo-roten, så dist/ ligger i build-contexten):
#   docker build -f tooling/docker/server-runtime/Dockerfile -t ava-server-runtime .
FROM debian:stable-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates openssh-client \
  && rm -rf /var/lib/apt/lists/*

# Båda linux-arkitekturerna; entrypoint väljer rätt via `uname -m`.
COPY dist/server-runtime/ava-server-runtime-linux-x64   /opt/ava/bin/ava-server-runtime-linux-x64
COPY dist/server-runtime/ava-server-runtime-linux-arm64 /opt/ava/bin/ava-server-runtime-linux-arm64
COPY tooling/docker/server-runtime/entrypoint.sh        /entrypoint.sh
RUN chmod +x /opt/ava/bin/ava-server-runtime-linux-* /entrypoint.sh \
  && mkdir -p /var/lib/ava

# Working-copy:n (firma.git-klonen) ligger på en volym (se docker-compose.yml).
ENV AVA_SR_WORK_DIR=/var/lib/ava/firma

ENTRYPOINT ["/entrypoint.sh"]
