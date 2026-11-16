#!/usr/bin/env bash
# Phase H Step 5: roll the app back to the previous digest (docs/launch/HOSTINGER-RUNBOOK.md §12).
#
#   sudo /opt/ovelo/rollback.sh                 (the digest in /etc/ovelo/previous)
#   sudo /opt/ovelo/rollback.sh sha256:<hex>    (an explicit earlier digest)
#
# Migrations are FORWARD-ONLY: a rollback never touches the database. That is safe only because
# every migration is additive (new tables, new nullable columns, new indexes), so an older build
# runs on the newer schema. AGENTS.md makes that a rule; a destructive migration needs its own
# two-step plan (expand, deploy, then contract in a later release).
# The signature is verified again: a rollback target must still be a signed image of this repo.
set -Eeuo pipefail
umask 077

REPO="${OVELO_IMAGE_REPO:-ghcr.io/labsofaroma/ovelo-web}"
ETC="${OVELO_ETC:-/etc/ovelo}"
COMPOSE_FILE="${OVELO_COMPOSE_FILE:-/opt/ovelo/docker-compose.yml}"
SIGNER_IDENTITY='^https://github\.com/labsofaroma/ovelo/\.github/workflows/image\.yml@refs/(heads/main|tags/v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?)$'
OIDC_ISSUER="https://token.actions.githubusercontent.com"

# Compose reads .env next to the compose file for ${OVELO_IMAGE}, so plain `docker compose ps`,
# `logs`, `exec` and `stop` (host-check.sh, kill-switch.md, the runbook) use the running digest.
pin_image() {
  local file
  file="$(dirname "$COMPOSE_FILE")/.env"
  printf 'OVELO_IMAGE=%s\n' "$1" > "${file}.tmp" && chmod 0644 "${file}.tmp" && mv -f "${file}.tmp" "$file"
}

log() { printf '%s rollback: %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }
die() { log "ERROR: $*"; exit "${2:-1}"; }

[ "$#" -le 1 ] || die "usage: rollback.sh [sha256:<64 hex>]" 2
if [ "$#" -eq 1 ]; then
  case "$1" in sha256:*) TARGET="${REPO}@$1" ;; *) TARGET="$1" ;; esac
else
  [ "$(id -u)" -eq 0 ] || die "run with sudo" 2
  TARGET="$(cat "${ETC}/previous" 2>/dev/null || true)"
  [ -n "$TARGET" ] || die "no previous digest in ${ETC}/previous"
fi
[[ "$TARGET" =~ ^${REPO//./\\.}@sha256:[0-9a-f]{64}$ ]] \
  || die "refusing '${TARGET}': only ${REPO}@sha256:<64 lowercase hex>" 2
[ "$(id -u)" -eq 0 ] || die "run with sudo" 2

CURRENT="$(cat "${ETC}/current" 2>/dev/null || true)"
log "verifying the signature of ${TARGET}"
cosign verify "$TARGET" \
  --certificate-identity-regexp "$SIGNER_IDENTITY" \
  --certificate-oidc-issuer "$OIDC_ISSUER" >/dev/null \
  || die "signature verification failed (or ghcr.io login missing: HOSTINGER-RUNBOOK §2.8)"
docker pull --quiet "$TARGET" >/dev/null \
  || die "pull failed: is root logged in to ghcr.io (HOSTINGER-RUNBOOK §2.8)?"
log "switching app to ${TARGET} (database untouched: migrations are forward-only)"
OVELO_IMAGE="$TARGET" docker compose -f "$COMPOSE_FILE" up -d --wait --wait-timeout 150 app cloudflared \
  || die "rollback did not become healthy: use kill-switch.md and check 'docker compose -f ${COMPOSE_FILE} logs app'"
printf '%s\n' "$TARGET" > "${ETC}/current"
pin_image "$TARGET"
[ -n "$CURRENT" ] && [ "$CURRENT" != "$TARGET" ] && printf '%s\n' "$CURRENT" > "${ETC}/previous"
log "rolled back to ${TARGET}; the version rolled away from is now in ${ETC}/previous"
