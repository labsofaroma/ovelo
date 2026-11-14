#!/usr/bin/env bash
# Local Redis + Upstash-compatible REST proxy (M7). LOCAL ONLY: Docker, a test token, 127.0.0.1.
#
#   scripts/local-redis.sh up | down | env
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE=(docker compose -f scripts/local-redis.compose.yml)
URL="http://127.0.0.1:8079"
TOKEN="aroma-local-redis-token"

case "${1:-up}" in
  up)
    docker info >/dev/null 2>&1 || { echo "local-redis: Docker is not running." >&2; exit 1; }
    "${COMPOSE[@]}" up -d --wait >/dev/null
    for _ in $(seq 1 60); do
      if curl -sf -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
        -d '["PING"]' "$URL" 2>/dev/null | grep -q PONG; then
        echo "local-redis: ready. UPSTASH_REDIS_REST_URL=$URL"
        exit 0
      fi
      sleep 1
    done
    echo "local-redis: the REST proxy did not become ready." >&2
    exit 1
    ;;
  down) "${COMPOSE[@]}" down -v ;;
  env)
    echo "export UPSTASH_REDIS_REST_URL='$URL'"
    echo "export UPSTASH_REDIS_REST_TOKEN='$TOKEN'"
    ;;
  *) echo "usage: $0 up|down|env" >&2; exit 2 ;;
esac
