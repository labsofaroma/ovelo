#!/usr/bin/env bash
# Phase H Step 5: deploy one image DIGEST to the VPS (docs/launch/HOSTINGER-RUNBOOK.md §8).
#
#   sudo /opt/ovelo/deploy.sh ghcr.io/labsofovelo/ovelo-web@sha256:<64 hex>
#   sudo /opt/ovelo/deploy.sh sha256:<64 hex>            (the repository is implied)
#
# 1. Refuse anything but a digest of OUR repository; check /etc/ovelo ownership and modes.
# 2. Verify the image signature (cosign keyless: signed by this repo's image.yml workflow on
#    main or a v* tag, through GitHub's OIDC issuer). No signature, no deploy.
# 3. Pull by digest (content-addressed: what runs is exactly what CI built and signed).
# 4. Boot the candidate OFF the traffic path (no network to cloudflared) and wait for healthy:
#    a bad env or a broken image fails here, while the current version keeps serving.
# 5. Run the database migrations as a one-shot container with the MIGRATION role
#    (/etc/ovelo/migrate.env), never the app role. Migrations are forward-only and additive.
# 6. Switch: recreate `app` on the new digest (the old one drains for up to 65 s, then the new
#    one must be healthy). Expected downtime: about 10-20 s (drain of in-flight requests plus a
#    cold start). A trade submit cut in that window is safe to retry (its request id is claimed
#    before broadcast; a replay never broadcasts twice).
# 7. Keep the previous digest in /etc/ovelo/previous for rollback.sh. If the switch fails, roll
#    back to the previous digest automatically.
set -Eeuo pipefail
umask 077

REPO="${OVELO_IMAGE_REPO:-ghcr.io/labsofovelo/ovelo-web}"
ETC="${OVELO_ETC:-/etc/ovelo}"
COMPOSE_FILE="${OVELO_COMPOSE_FILE:-/opt/ovelo/docker-compose.yml}"
SIGNER_IDENTITY='^https://github\.com/labsofovelo/ovelo/\.github/workflows/image\.yml@refs/(heads/main|tags/v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?)$'
OIDC_ISSUER="https://token.actions.githubusercontent.com"

log() { printf '%s deploy: %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }
die() { log "ERROR: $*"; exit "${2:-1}"; }

# --- 1. arguments -------------------------------------------------------------------------
[ "$#" -eq 1 ] || die "usage: deploy.sh <${REPO}@sha256:<64 hex> | sha256:<64 hex>>" 2
ARG="$1"
case "$ARG" in
  sha256:*) IMAGE="${REPO}@${ARG}" ;;
  *) IMAGE="$ARG" ;;
esac
[[ "$IMAGE" =~ ^${REPO//./\\.}@sha256:[0-9a-f]{64}$ ]] \
  || die "refusing '${ARG}': only ${REPO}@sha256:<64 lowercase hex> (a digest, never a tag)" 2

[ "$(id -u)" -eq 0 ] || die "run with sudo (reads ${ETC}, mode 0700)" 2

for tool in docker cosign; do
  command -v "$tool" >/dev/null || die "${tool} is not installed (HOSTINGER-RUNBOOK §2)"
done

# --- secrets on disk: owner and mode ------------------------------------------------------
mode_of() { stat -c '%a %u' "$1"; }
[ "$(mode_of "$ETC")" = "700 0" ] || die "${ETC} must be root-owned, mode 0700"
for f in ovelo.env migrate.env; do
  [ -f "${ETC}/${f}" ] || die "${ETC}/${f} is missing"
  [ "$(mode_of "${ETC}/${f}")" = "600 0" ] || die "${ETC}/${f} must be root-owned, mode 0600"
done
[ "$(mode_of "${ETC}/tunnel-token")" = "400 65532" ] \
  || die "${ETC}/tunnel-token must be owned by 65532 (cloudflared), mode 0400"
# Variables that must never be on the VPS (the app refuses most of them at boot anyway).
if grep -Eq '^(OVELO_TRUST_PROXY|OVELO_SKIP_ENV_CHECK|SENTRY_AUTH_TOKEN|OVELO_V1_TEST_[A-Z_]*|OVELO_V1_LOCALNET_[A-Z_]*|OVELO_LOCAL_NEON_WS_PROXY|NEXT_PUBLIC_OVELO_E2E_WALLET)=.' "${ETC}/ovelo.env"; then
  die "${ETC}/ovelo.env sets a test-only or removed variable (see SELF-HOST.md §2)"
fi
grep -Eq '^DATABASE_URL=.' "${ETC}/migrate.env" || die "${ETC}/migrate.env has no DATABASE_URL"
# The ROLE (the URL's user) must differ, however the URLs are spelled (quotes, parameters).
db_user() {
  local v
  v="$(grep -E '^DATABASE_URL=' "$1" | head -1 | cut -d= -f2-)"
  v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
  v="${v#*://}"
  [[ "$v" == *@* ]] || return 0
  v="${v%%@*}"
  printf '%s' "${v%%:*}"
}
MIGRATE_USER="$(db_user "${ETC}/migrate.env")"
[ -n "$MIGRATE_USER" ] || die "${ETC}/migrate.env DATABASE_URL names no user (role)"
if [ "$MIGRATE_USER" = "$(db_user "${ETC}/ovelo.env")" ]; then
  die "migrate.env must use the MIGRATION role, not the app role (same user in both DATABASE_URLs)"
fi

compose() { OVELO_IMAGE="$1" docker compose -f "$COMPOSE_FILE" "${@:2}"; }

# Compose reads .env next to the compose file for ${OVELO_IMAGE}, so plain `docker compose ps`,
# `logs`, `exec` and `stop` (host-check.sh, kill-switch.md, the runbook) use the running digest.
pin_image() {
  local file
  file="$(dirname "$COMPOSE_FILE")/.env"
  printf 'OVELO_IMAGE=%s\n' "$1" > "${file}.tmp" && chmod 0644 "${file}.tmp" && mv -f "${file}.tmp" "$file"
}

# --- 2. signature -------------------------------------------------------------------------
log "verifying the signature of ${IMAGE}"
cosign verify "$IMAGE" \
  --certificate-identity-regexp "$SIGNER_IDENTITY" \
  --certificate-oidc-issuer "$OIDC_ISSUER" >/dev/null \
  || die "signature verification failed: not built and signed by labsofovelo/ovelo image.yml (or ghcr.io login missing: HOSTINGER-RUNBOOK §2.8)"

# --- 3. pull ------------------------------------------------------------------------------
log "pulling by digest"
docker pull --quiet "$IMAGE" >/dev/null \
  || die "pull failed: is root logged in to ghcr.io with a read:packages token (HOSTINGER-RUNBOOK §2.8)?"

# --- 4. candidate boot, off the traffic path ----------------------------------------------
CANDIDATE="ovelo-candidate-$$"
cleanup() { docker rm -f "$CANDIDATE" >/dev/null 2>&1 || true; }
trap cleanup EXIT
log "booting the candidate (no traffic) to validate the image and the env"
docker run -d --name "$CANDIDATE" --env-file "${ETC}/ovelo.env" \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m --tmpfs /app/apps/web/.next/cache:rw,size=64m \
  --cap-drop ALL --security-opt no-new-privileges:true --user 10001:10001 \
  --memory 1g --pids-limit 256 "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}} {{.State.Running}}' "$CANDIDATE")"
  case "$status" in
    "healthy true") break ;;
    *" false") docker logs --tail 40 "$CANDIDATE" >&2 || true; die "the candidate exited at boot (env or image problem; see above). Nothing was changed." ;;
  esac
  sleep 2
done
[ "${status:-}" = "healthy true" ] || die "the candidate never became healthy. Nothing was changed."
cleanup
log "candidate healthy"

# --- 5. migrations (separate role, one-shot) ----------------------------------------------
log "running migrations with the migration role"
docker run --rm --env-file "${ETC}/migrate.env" --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true --user 10001:10001 "$IMAGE" \
  node /app/deploy/migrate.mjs \
  || die "migrations failed; the current version keeps serving (migrations are additive)"

# --- 6. switch ----------------------------------------------------------------------------
PREVIOUS="$(cat "${ETC}/current" 2>/dev/null || true)"
log "switching app to the new digest (expected downtime: about 10-20 s)"
if compose "$IMAGE" up -d --wait --wait-timeout 150 app cloudflared; then
  if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$IMAGE" ]; then
    printf '%s\n' "$PREVIOUS" > "${ETC}/previous"
  fi
  printf '%s\n' "$IMAGE" > "${ETC}/current"
  pin_image "$IMAGE"
  chmod 0600 "${ETC}/current" "${ETC}/previous" 2>/dev/null || true
  log "deployed ${IMAGE}"
  log "previous digest (rollback.sh): ${PREVIOUS:-none}"
else
  log "the new version did not become healthy"
  if [ -n "$PREVIOUS" ]; then
    log "rolling back to ${PREVIOUS}"
    compose "$PREVIOUS" up -d --wait --wait-timeout 150 app cloudflared \
      || die "ROLLBACK FAILED: run kill-switch.md and check 'docker compose -f ${COMPOSE_FILE} logs app'"
    pin_image "$PREVIOUS"
    die "deploy failed and was rolled back to the previous digest"
  fi
  die "deploy failed and there is no previous digest to roll back to"
fi

# --- 7. post-deploy check -----------------------------------------------------------------
compose "$IMAGE" exec -T app node /app/deploy/healthcheck.mjs \
  && log "liveness ok; now run the verification list (HOSTINGER-RUNBOOK §8)"
