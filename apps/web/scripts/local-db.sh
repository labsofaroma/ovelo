#!/usr/bin/env bash
# Local Postgres + Neon WebSocket proxy for development and the creator E2E (M5b B6).
# LOCAL ONLY: Docker on this machine, test credentials, ports bound to 127.0.0.1.
#
#   scripts/local-db.sh up       start (or reuse), wait until ready, apply migrations
#   scripts/local-db.sh reset    drop the data volume, start fresh, migrate
#   scripts/local-db.sh down     stop and remove the containers and data
#   scripts/local-db.sh env      print the variables to export
#
# Then: eval "$(scripts/local-db.sh env)" before `pnpm dev`, `next start` or scripts/create-invite.ts.
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE=(docker compose -f scripts/local-db.compose.yml)
export DATABASE_URL="postgres://ovelo:ovelo-local-only@127.0.0.1:54329/ovelo"
export OVELO_LOCAL_NEON_WS_PROXY="127.0.0.1:54330"

need_docker() {
  if ! docker info >/dev/null 2>&1; then
    echo "local-db: Docker is not running. Start Docker Desktop (or another engine), or use a Neon dev branch DATABASE_URL instead." >&2
    exit 1
  fi
}

wait_ready() {
  for _ in $(seq 1 60); do
    if "${COMPOSE[@]}" exec -T postgres pg_isready -U ovelo -d ovelo >/dev/null 2>&1 &&
      (exec 3<>/dev/tcp/127.0.0.1/54330) 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  echo "local-db: Postgres or the proxy did not become ready." >&2
  exit 1
}

case "${1:-up}" in
  up)
    need_docker
    "${COMPOSE[@]}" up -d --wait >/dev/null
    wait_ready
    pnpm exec tsx server/db/migrate.ts
    echo "local-db: ready. DATABASE_URL=$DATABASE_URL (via ws proxy $OVELO_LOCAL_NEON_WS_PROXY)"
    ;;
  reset)
    need_docker
    "${COMPOSE[@]}" down -v >/dev/null 2>&1 || true
    "$0" up
    ;;
  down)
    need_docker
    "${COMPOSE[@]}" down -v
    ;;
  env)
    echo "export DATABASE_URL='$DATABASE_URL'"
    echo "export OVELO_LOCAL_NEON_WS_PROXY='$OVELO_LOCAL_NEON_WS_PROXY'"
    ;;
  *)
    echo "usage: $0 up|reset|down|env" >&2
    exit 2
    ;;
esac
