# Kill switch (self-host)

Three levers, fastest first. None of them needs a new image or a deploy. Each one is undone by reversing the same step.

## 1. Stop trading (seconds)

`AROMA_TRADING=off` refuses every mainnet trading entry point (quote, submit, the Action POST) with 503 `TRADING_UNAVAILABLE`. Reads, receipts, the Action confirm callback and devnet plan closes stay open, so users can still see and exit.

```bash
sudo sed -i 's/^AROMA_TRADING=.*/AROMA_TRADING=off/' /etc/aroma/aroma.env
sudo docker compose -f /opt/aroma/docker-compose.yml up -d --wait app
# Verify (expects 503 TRADING_UNAVAILABLE):
curl -s -X POST https://<host>/api/v1/trade/quote -H 'content-type: application/json' -d '{}'
```

Recreating the container drains in-flight requests first (up to 65 s), so a submit already sent finishes. To undo, set `AROMA_TRADING=on` and run the same command.

## 2. Cloudflare "Under Attack" mode (seconds, at the edge)

Cloudflare dashboard → the zone → **Overview → Quick Actions → Under Attack Mode: On**. Every visitor gets a JavaScript challenge before reaching the tunnel.

Side effect: Blink unfurlers and wallets that call `/actions.json` and `/api/v1/actions/**` can't pass a JavaScript challenge, so Blinks stop while it's on. QStash can't pass it either, so notifications pause. Prefer a WAF custom rule scoped to the attacked path when you can. Turn it off as soon as the attack ends.

## 3. Pause notifications (seconds)

`AROMA_NOTIFICATIONS=off` stops scans and deliveries without touching trading.

```bash
sudo sed -i 's/^AROMA_NOTIFICATIONS=.*/AROMA_NOTIFICATIONS=off/' /etc/aroma/aroma.env
sudo docker compose -f /opt/aroma/docker-compose.yml up -d --wait app
```

You can also pause the schedule in the Upstash console (QStash → Schedules → Pause), which stops the calls at the source.

## 4. Take the site off the internet (last resort)

```bash
sudo docker compose -f /opt/aroma/docker-compose.yml stop cloudflared   # the tunnel drops; Cloudflare shows its error page
```

The app keeps running, unreachable. `start cloudflared` brings it back. To make it permanent, revoke the tunnel in Cloudflare Zero Trust → Networks → Tunnels (HOSTINGER-RUNBOOK §12).

## What none of these touch

User funds. The server holds no user keys: every purchase is a transaction the user signs in their own wallet. Stopping the app or the tunnel can't move, freeze or lose anyone's tokens.
