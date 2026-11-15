#!/usr/bin/env bash
# Phase H: host checks for the VPS (HOSTINGER-RUNBOOK §9), run by cron every 5 minutes as root.
# Alerts the webhook in /etc/aroma/alert-webhook (Slack or Discord incoming webhook) when:
#   - a filesystem (/, /var/lib/docker) is above 80% full;
#   - memory available is below 10%;
#   - the app or cloudflared container is not running, or the app is not healthy;
#   - the OS asks for a reboot (security updates applied).
# Prints the findings, exits 1 if there is any. Sends nothing secret: names and percentages only.
set -Eeuo pipefail

ETC="${AROMA_ETC:-/etc/aroma}"
COMPOSE_FILE="${AROMA_COMPOSE_FILE:-/opt/aroma/docker-compose.yml}"
DISK_MAX="${AROMA_DISK_MAX_PERCENT:-80}"
MEM_MIN="${AROMA_MEM_MIN_PERCENT:-10}"
problems=()

for mount in / /var/lib/docker; do
  [ -d "$mount" ] || continue
  used="$(df --output=pcent "$mount" | tail -1 | tr -dc '0-9')"
  [ "${used:-0}" -le "$DISK_MAX" ] || problems+=("disk ${mount} at ${used}%")
done

available="$(awk '/^MemAvailable:/ {a=$2} /^MemTotal:/ {t=$2} END {printf "%d", (a*100)/t}' /proc/meminfo)"
[ "${available:-100}" -ge "$MEM_MIN" ] || problems+=("memory available ${available}%")

if command -v docker >/dev/null; then
  for service in app cloudflared; do
    id="$(docker compose -f "$COMPOSE_FILE" ps -q "$service" 2>/dev/null || true)"
    if [ -z "$id" ]; then problems+=("${service} not running"); continue; fi
    state="$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id")"
    case "$service:$state" in
      "app:running healthy" | "cloudflared:running "*) ;;
      *) problems+=("${service} ${state}") ;;
    esac
  done
fi

[ ! -f /var/run/reboot-required ] || problems+=("reboot required (security updates)")

if [ "${#problems[@]}" -eq 0 ]; then
  exit 0
fi

message="aroma $(hostname -s): ${problems[*]}"
printf '%s\n' "$message"
if [ -s "${ETC}/alert-webhook" ]; then
  url="$(head -1 "${ETC}/alert-webhook")"
  # Slack reads "text", Discord reads "content"; both ignore the other key.
  payload="$(printf '{"text":"%s","content":"%s"}' "${message//\"/\'}" "${message//\"/\'}")"
  curl -fsS -m 10 -H 'content-type: application/json' -d "$payload" "$url" >/dev/null || true
fi
exit 1
