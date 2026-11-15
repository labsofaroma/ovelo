#!/usr/bin/env bash
# Phase H Step 5: roll the app back to the previous digest (docs/launch/HOSTINGER-RUNBOOK.md §12).
#
#   sudo /opt/aroma/rollback.sh                 (the digest in /etc/aroma/previous)
#   sudo /opt/aroma/rollback.sh sha256:<hex>    (an explicit earlier digest)
#
# Migrations are FORWARD-ONLY: a rollback never touches the database. That is safe only because
# every migration is additive (new tables, new nullable columns, new indexes), so an older build
# runs on the newer schema. AGENTS.md makes that a rule; a destructive migration needs its own
# two-step plan (expand, deploy, then contract in a later release).
# The signature is verified again: a rollback target must still be a signed image of this repo.
set -Eeuo pipefail
umask 077

REPO="${AROMA_IMAGE_REPO:-ghcr.io/aromalabs/aroma-web}"
ETC="${AROMA_ETC:-/etc/aroma}"
COMPOSE_FILE="${AROMA_COMPOSE_FILE:-/opt/aroma/docker-compose.yml}"
SIGNER_IDENTITY='^https://github\.com/aromalabs/aroma/\.github/workflows/image\.yml@refs/(heads/main|tags/v[0-9][0-9.]*)$'
OIDC_ISSUER="https://token.actions.githubusercontent.com"

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
  || die "signature verification failed"
docker pull --quiet "$TARGET" >/dev/null
log "switching app to ${TARGET} (database untouched: migrations are forward-only)"
AROMA_IMAGE="$TARGET" docker compose -f "$COMPOSE_FILE" up -d --wait --wait-timeout 150 app cloudflared \
  || die "rollback did not become healthy: use kill-switch.md and check 'docker compose logs app'"
printf '%s\n' "$TARGET" > "${ETC}/current"
[ -n "$CURRENT" ] && [ "$CURRENT" != "$TARGET" ] && printf '%s\n' "$CURRENT" > "${ETC}/previous"
log "rolled back to ${TARGET}; the version rolled away from is now in ${ETC}/previous"
