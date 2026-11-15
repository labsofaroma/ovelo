# Hostinger VPS behind Cloudflare: owner runbook (Phase H)

An ordered checklist for running Ovelo on a Hostinger VPS behind Cloudflare. Every step ends with a **verify** command. 💲 marks a step that costs money. Nothing here was run by a session: no account, server, DNS record or tunnel was touched (Phase H hard rule 2). The runtime contract is [SELF-HOST.md](SELF-HOST.md); the Vercel path stays in [BETA-RUNBOOK.md](BETA-RUNBOOK.md) and [CUTOVER-RUNBOOK.md](CUTOVER-RUNBOOK.md).

**Architecture.** User → Cloudflare (DNS, TLS, WAF, rate limits, cache rules, Transform Rule adding `x-ovelo-origin`) → Cloudflare Tunnel (outbound-only from the VPS) → `cloudflared` → `app` (one container, not published on the host). Neon, Upstash, the RPC providers, Jupiter, Sentry and Turnstile stay managed. **No SOL is needed to host.** The server holds no user keys.

## 1. Hostinger account and VPS 💲

- [ ] Turn on 2FA for the Hostinger account (hPanel → Account → Security). Use a password manager, and keep the recovery codes offline.
- [ ] 💲 Buy a **KVM 2** (2 vCPU, 8 GB RAM, NVMe) or larger with **Ubuntu 24.04 LTS** (plain OS, no control panel). Step 8 of Phase H measured the app under load; see [SELF-HOST.md §7](SELF-HOST.md#7-measured).
- [ ] Pick the data centre closest to your RPC provider's region and to Neon's region (for example both in us-east or both in eu-central). Every trade does several RPC round trips.
- [ ] Turn on automatic weekly backups, and take a manual snapshot before every OS upgrade (hPanel → VPS → Backups and Snapshots). Check what your plan includes; extra backups may cost more.
- [ ] Put your SSH **public** key in hPanel at creation, so the root password is never used.

**Verify:** hPanel shows the VPS running Ubuntu 24.04, backups on. From your machine: `ssh root@<VPS_IP> 'lsb_release -ds'` prints `Ubuntu 24.04… LTS`.

## 2. First login and hardening

Keep one SSH session open while changing SSH or the firewall. hPanel's **browser terminal** is the fallback if you lock yourself out.

**2.1 Admin user, SSH keys only.**

```bash
adduser --gecos "" opsadmin && usermod -aG sudo opsadmin
install -d -m 0700 -o opsadmin -g opsadmin /home/opsadmin/.ssh
install -m 0600 -o opsadmin -g opsadmin /root/.ssh/authorized_keys /home/opsadmin/.ssh/authorized_keys
cat > /etc/ssh/sshd_config.d/99-ovelo.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
AllowUsers opsadmin
X11Forwarding no
MaxAuthTries 3
EOF
sshd -t && systemctl reload ssh
```

**Verify** (in a NEW terminal, before closing the old one): `ssh opsadmin@<VPS_IP> 'sudo sshd -T | grep -E "^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin) "'` prints `no` three times, and `ssh root@<VPS_IP>` is refused.

**2.2 SSH only over Tailscale (recommended; the free personal plan is enough).**

- [ ] Install Tailscale from its apt repository (tailscale.com/download/linux/ubuntu-2404), then run `sudo tailscale up --ssh=false`. Approve the machine in the Tailscale admin console, and turn off key expiry for this machine.
- [ ] From now on, connect with `ssh opsadmin@<tailscale-name>`.

Tailscale needs no inbound port: it connects outbound. The alternative is Cloudflare Access for SSH (`cloudflared access`), which also works. Pick one.

**2.3 Firewall: nothing inbound but SSH over Tailscale. No 80/443: the tunnel is outbound.**

```bash
sudo ufw default deny incoming && sudo ufw default allow outgoing
sudo ufw allow in on tailscale0 to any port 22 proto tcp
sudo ufw enable
```

- [ ] In hPanel → VPS → **Firewall**, create a rule set that drops all inbound traffic, and attach it. This mirrors ufw one layer out. Tailscale and the tunnel still work, because both connect outbound.

**Verify:** `sudo ufw status verbose` shows `deny (incoming)` and only `22/tcp on tailscale0`. From a machine **outside** your tailnet: `nc -vz -w 5 <VPS_IP> 22`, `nc -vz -w 5 <VPS_IP> 80` and `nc -vz -w 5 <VPS_IP> 443` all time out.

Note: Docker can bypass ufw for **published** ports. The compose bundle publishes none, and §8 verifies that.

**2.4 Updates, fail2ban, time.**

```bash
sudo apt update && sudo apt -y full-upgrade
sudo apt -y install unattended-upgrades fail2ban chrony
sudo dpkg-reconfigure -plow unattended-upgrades      # answer Yes: security updates automatically
sudo systemctl enable --now fail2ban chrony
```

Accurate time matters: trade authorizations expire 60 s after a quote, and Solana blockhashes expire by height.

**Verify:** `systemctl is-active unattended-upgrades fail2ban chrony` prints `active` three times. `sudo unattended-upgrade --dry-run -d 2>&1 | tail -3` ends without errors. `sudo fail2ban-client status sshd` shows the jail. In `chronyc tracking`, `System time` is within a few ms and `Leap status : Normal`.

**2.5 Docker Engine (Docker's official apt repository, not the Ubuntu snap).**

- [ ] Install `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin` and `docker-compose-plugin` following docs.docker.com/engine/install/ubuntu.
- [ ] Set the daemon defaults:

```bash
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "5" },
  "live-restore": true,
  "no-new-privileges": true
}
EOF
sudo systemctl restart docker
```

- [ ] **Do not** add `opsadmin` to the `docker` group: membership is equivalent to root. Use `sudo docker …`.

  Decision: **rootful Docker with hardened containers**, not rootless. Every container already runs as a non-root UID with a read-only root filesystem, no capabilities and `no-new-privileges`. Rootless Docker adds little on a single-purpose VPS, and it complicates the cgroup limits and networking the bundle relies on.

**Verify:** `sudo docker version --format '{{.Server.Version}}'` prints a version. `sudo docker info --format '{{.LoggingDriver}} {{.SecurityOptions}}'` shows `json-file` and `no-new-privileges`. `id opsadmin` does not list `docker`.

**2.6 cosign, to verify image signatures in `deploy.sh`.**

```bash
V=v3.1.4
cd /tmp && curl -fsSLO "https://github.com/sigstore/cosign/releases/download/${V}/cosign-linux-amd64" \
  && curl -fsSLO "https://github.com/sigstore/cosign/releases/download/${V}/cosign_checksums.txt" \
  && grep ' cosign-linux-amd64$' cosign_checksums.txt | sha256sum -c - \
  && sudo install -m 0755 cosign-linux-amd64 /usr/local/bin/cosign && rm -f cosign-linux-amd64 cosign_checksums.txt
```

**Verify:** `cosign version` prints `v3.1.4`.

**2.7 Directories.**

```bash
sudo install -d -m 0700 -o root -g root /etc/ovelo
sudo install -d -m 0755 -o root -g root /opt/ovelo
```

- [ ] Copy `deploy/hostinger/docker-compose.yml`, `deploy.sh`, `rollback.sh` and `host-check.sh` from the **release tag you deploy** to `/opt/ovelo/` (`scp` over Tailscale). Then run `sudo chmod 0750 /opt/ovelo/*.sh && sudo chown root:root /opt/ovelo/*`.

**Verify:** `sudo stat -c '%a %U %n' /etc/ovelo /opt/ovelo /opt/ovelo/*` shows `700 root /etc/ovelo`, `755 root /opt/ovelo`, `750` for the scripts and `644` for the compose file. After the first deploy, `/opt/ovelo/.env` (`644 root`) holds only `OVELO_IMAGE=<the running digest>`: `deploy.sh` and `rollback.sh` write it, so plain `sudo docker compose -f /opt/ovelo/docker-compose.yml ps|logs|exec|stop` work. Never put a secret in it.

**2.8 Registry login (the image is private).**

The image lives in GitHub's container registry (GHCR) under the repository's account. While the package is private, `docker pull` and `cosign verify` on the VPS need a read-only login.

- [ ] On GitHub: Settings → Developer settings → Personal access tokens → **Tokens (classic)** → a token with **only `read:packages`**, named `ovelo-vps-pull`, with an expiry (for example 1 year; put the renewal in your calendar). Fine-grained tokens do not cover GHCR packages yet.
- [ ] On the VPS, as root, without echoing it or saving it in history:

```bash
sudo sh -c 'read -rs T && printf %s "$T" | docker login ghcr.io -u <github-user> --password-stdin'   # paste the token, Enter
```

  `docker login` stores it in `/root/.docker/config.json` (mode 0600); `cosign` reads the same file. Alternative: make the package public (GitHub → the package → Package settings → Change visibility). The image holds no secret (the build takes public values only, and the client-secret scan runs inside it), so public is acceptable; then skip this step.

**Verify:** `sudo stat -c '%a %U' /root/.docker/config.json` prints `600 root`. After the first `image.yml` run, `sudo docker manifest inspect ghcr.io/<owner>/ovelo-web@sha256:<digest> >/dev/null && echo ok` prints `ok`.

## 3. Cloudflare (the free plan is enough for the beta)

- [ ] Add the domain to Cloudflare and move the nameservers at your registrar. Turn on 2FA for the Cloudflare account, and keep account members to the minimum: anyone who can read the Transform Rule can read the origin secret.

  **Verify:** `dig +short NS <domain>` shows the two `*.ns.cloudflare.com` servers.

- [ ] **Tunnel:** Zero Trust → Networks → Tunnels → *Create a tunnel* → **Cloudflared** → name it `ovelo-beta`. Copy only the token (the long string after `--token`). Write it straight to the VPS file without echoing it or saving it in shell history:

```bash
sudo sh -c 'umask 077; cat > /etc/ovelo/tunnel-token'    # paste the token, then Enter and Ctrl-D
sudo chown 65532:65532 /etc/ovelo/tunnel-token && sudo chmod 0400 /etc/ovelo/tunnel-token
```

- [ ] **Public hostname:** `beta.<domain>` → service `HTTP`, URL `app:3000` (the compose service name). Leave *HTTP Host Header* empty and *No TLS Verify* off (not used over http).

  **Verify:** `sudo stat -c '%a %u' /etc/ovelo/tunnel-token` prints `400 65532`. The tunnel shows *Inactive* until §8 starts it.

- [ ] **SSL/TLS → Edge Certificates:** *Always Use HTTPS* on, *Minimum TLS Version* 1.2, *TLS 1.3* on. Leave HSTS **off here**: the app sends its own (two years, preload) on production and beta responses. Universal SSL covers `beta.<domain>`.

  **Verify:** `curl -sI http://beta.<domain>/` answers `301` to `https://` (after §8).

- [ ] **Transform Rule (origin lock):** Rules → Transform Rules → *Modify Request Header* → name it `ovelo-origin`. Condition: hostname equals `beta.<domain>`. Action: **Set static**, header `x-ovelo-origin`, value = `OVELO_ORIGIN_SECRET` (§4). "Set" overwrites anything a client sends.

  **Verify (after §8):** `curl -s -o /dev/null -w '%{http_code}\n' https://beta.<domain>/terms` prints `200`. From inside the VPS, `sudo docker compose -f /opt/ovelo/docker-compose.yml exec app node -e "fetch('http://127.0.0.1:3000/terms').then(r=>console.log(r.status))"` prints `403`: no secret means no answer.

- [ ] **WAF:** Security → WAF → *Managed rules*: turn on the Cloudflare Free Managed Ruleset. Then add **custom rules**:
  1. **Geo backup for trading** (the app stays authoritative). Expression: `(ip.src.country in {"US" "T1"}) and http.request.method eq "POST" and (starts_with(http.request.uri.path, "/api/v1/trade/") or starts_with(http.request.uri.path, "/api/v1/actions/baskets/"))`. Action: Block. Use the same country list as `OVELO_COMPLIANCE_RESTRICTED_COUNTRIES` plus `T1` (Tor). Don't block whole pages: restricted visitors may browse (COMPLIANCE.md).
  2. **Scoped challenge for API abuse** (optional, when attacked). Expression: `starts_with(http.request.uri.path, "/api/") and not cf.client.bot and not starts_with(http.request.uri.path, "/api/v1/actions/") and http.request.uri.path ne "/api/v1/notifications/deliver" and http.request.uri.path ne "/api/v1/notifications/telegram"`. Action: Managed Challenge.
  - Keep **Bot Fight Mode off**. On the free plan it can't exempt paths, so it would challenge Blink unfurlers (`/actions.json`, `/api/v1/actions/**`), QStash (the notifications worker) and Telegram's webhook, and they can't solve challenges.

  **Verify (after §8):** `curl -s https://beta.<domain>/actions.json | head -c 80` returns JSON, not a challenge page. `curl -s -X POST https://beta.<domain>/api/v1/notifications/deliver -H 'content-type: application/json' -d '{}' -o /dev/null -w '%{http_code}\n'` prints `401` (the app refusing a missing bearer), not `403` from Cloudflare.

- [ ] **Rate limiting:** Security → WAF → *Rate limiting rules*. Create one for `/api/v1/trade/` (POST) at or below the app's 10 per minute per IP, then `/api/v1/actions/` POST and `/api/v1/faucet` if your plan allows more rules. The app's own Upstash limits (keyed on `CF-Connecting-IP`) always apply.

- [ ] **Cache rules (important):** Caching → Cache Rules. Every page carries a per-request CSP nonce, so **a cached HTML page breaks the site or reuses a nonce**.
  1. Rule `bypass-dynamic`: when `not starts_with(http.request.uri.path, "/_next/static/") and not starts_with(http.request.uri.path, "/_next/image") and not http.request.uri.path in {"/icon.svg" "/apple-icon" "/og.png"} and not starts_with(http.request.uri.path, "/images/") and not starts_with(http.request.uri.path, "/fonts/") and not starts_with(http.request.uri.path, "/token-logos/") and not starts_with(http.request.uri.path, "/company-logos/") and not starts_with(http.request.uri.path, "/xstocks-devnet/")`, then **Bypass cache**.
  2. Rule `static`: `/_next/static/*` is *Eligible for cache*, with the edge TTL respecting the origin (Next sends `immutable`).
  - Never create a "Cache Everything" rule.

  **Verify (after §8):** `curl -sI https://beta.<domain>/markets | grep -i cf-cache-status` prints `BYPASS` or `DYNAMIC`. Two requests to `/markets` carry **different** `nonce-` values in `content-security-policy`. `/_next/static/…` shows `HIT` on the second request.

- [ ] **Notifications:** Notifications → add *Tunnel health* (Zero Trust tunnel status changes) and the DDoS or security-event alerts your plan offers, sent to the owner's email.

## 4. Secrets (on the owner's machine, never in chat, a ticket, the repo or shell history)

- [ ] Generate each secret separately: `OVELO_TRADE_SECRET`, `OVELO_ORIGIN_SECRET`, `OVELO_NOTIFY_WORKER_SECRET` and `OVELO_REVALIDATE_SECRET`.

```bash
openssl rand -base64 48 | tr -d '\n' > ./trade.secret     # repeat per secret, each its own file
```

  Keep the files on an encrypted disk, and delete them after §4's offline backup. Never reuse one value for two variables: the boot refuses an origin secret equal to another secret.

- [ ] Fill `/etc/ovelo/ovelo.env` from `deploy/hostinger/ovelo.env.example`, on your machine, in an editor (not `echo`). Set `OVELO_DEPLOY_ENV=beta` and `OVELO_SITE_URL=https://beta.<domain>`. Don't put quotes around values. Copy it to the VPS and install it:

```bash
scp ./ovelo.env opsadmin@<tailscale-name>:~/ovelo.env
ssh opsadmin@<tailscale-name> 'sudo install -m 0600 -o root -g root ~/ovelo.env /etc/ovelo/ovelo.env && shred -u ~/ovelo.env'
```

- [ ] The same for `/etc/ovelo/migrate.env` (only `DATABASE_URL` of the migration role, §5).
- [ ] Put the **same** `OVELO_ORIGIN_SECRET` in the Cloudflare Transform Rule (§3).
- [ ] If you ever type a secret in a shell, prefix the command with a space (with `HISTCONTROL=ignorespace`), or `read -rs VAR`.

**Verify:** `sudo stat -c '%a %u %n' /etc/ovelo/*` shows `600 0` for the env files and `400 65532` for the tunnel token (UID 65532 has no name on the host, so print the number). `history | grep -c -E 'base64|SECRET='` prints `0`.

## 5. Database roles on Neon 💲 (PITR length depends on the plan)

Two roles: the app gets **DML only**, and migrations run with a separate role that owns the schema.

- [ ] **Fresh database:** create `ovelo_migrate` (Neon console → Roles), and run every migration with it (`deploy.sh` does this from `migrate.env`), so it owns every table.
  **Database already migrated by `neondb_owner`:** use `neondb_owner` as the migration role (it owns the tables), and in the SQL below replace `ovelo_migrate` with `neondb_owner`.
- [ ] Create the app role and its grants (SQL Editor, as the migration role):

```sql
CREATE ROLE ovelo_app WITH LOGIN PASSWORD '<generated, 32+ chars>';
GRANT CONNECT ON DATABASE neondb TO ovelo_app;
GRANT USAGE ON SCHEMA public TO ovelo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ovelo_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ovelo_app;
-- Tables and sequences that future migrations create get the same grants automatically:
ALTER DEFAULT PRIVILEGES FOR ROLE ovelo_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ovelo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ovelo_migrate IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ovelo_app;
```

- [ ] `ovelo.env` → `DATABASE_URL` = `ovelo_app` (pooled endpoint, `sslmode=require`). `migrate.env` → `DATABASE_URL` = the migration role. `deploy.sh` refuses to run if the two are equal.
- [ ] Turn on point-in-time restore (Neon → Settings → history retention). The window depends on the plan 💲.

**Verify:** connected as `ovelo_app` (psql with its URL), `CREATE TABLE t(i int);` fails with `permission denied for schema public`, and `SELECT count(*) FROM receipts;` works.

## 6. Upstash

- [ ] Redis: **eviction off** (Upstash console → the database → Configuration). Trade idempotency records and cap reservations must never be evicted. Use only the TLS REST endpoint (`https://…upstash.io`) and its token.
- [ ] QStash: put the signing keys (current and next) and the token in `ovelo.env`. Create the notifications schedule to `https://beta.<domain>/api/v1/notifications/deliver`, every minute, with header `Upstash-Forward-Authorization: Bearer <OVELO_NOTIFY_WORKER_SECRET>`. The request goes through Cloudflare, so the Transform Rule adds the origin header.

**Verify:** the Upstash console shows *Eviction: disabled*. After §8, the QStash schedule's log shows `200` deliveries.

## 7. Validate the env file

On your machine, from the repo at the release tag:

```bash
pnpm check:prod-env --env-file ./ovelo.env --profile beta --platform selfhost
```

**Verify:** it ends with `check:prod-env: OK`. Every finding is a variable name and a status, never a value. The `NEXT_PUBLIC_*` lines are warnings on self-host: they are build values, set as the `image.yml` repository variables (which refuses to build without the RPC URL and the Sentry DSN), not in `ovelo.env`.

## 8. First deploy and verification

- [ ] Take the digest from the `image` workflow run's summary (CI: push to `main` or a `v*` tag). Then:

```bash
sudo /opt/ovelo/deploy.sh sha256:<64 hex>
```

`deploy.sh` checks the signature, pulls by digest, boots the candidate off the traffic path, runs migrations with the migration role, then switches. The first deploy has no previous version to roll back to.

**Verification list** (all must pass before inviting anyone):

- [ ] **Headers on a page and an API route:**

```bash
curl -sI https://beta.<domain>/markets | grep -i -E '^(content-security-policy|strict-transport-security|x-frame-options|x-content-type-options|referrer-policy|permissions-policy):'
curl -sI https://beta.<domain>/api/v1/health | grep -i -E '^(content-security-policy|strict-transport-security|cache-control):'
```

  Expect a CSP with `'nonce-…'` and `frame-ancestors 'none'`, `strict-transport-security: max-age=63072000; includeSubDomains; preload`, `x-frame-options: DENY`, `nosniff`, and `cache-control: no-store` on the API.

- [ ] **No direct path to the app.** From outside: `nc -vz -w 5 <VPS_IP> 80`, `443` and `3000` all time out. `sudo docker compose -f /opt/ovelo/docker-compose.yml ps --format '{{.Name}} {{.Publishers}}'` shows no published ports. From inside the VPS, the `exec … fetch('http://127.0.0.1:3000/terms')` probe of §3 prints `403`.
- [ ] **Header spoofing does nothing:** from a non-restricted location, `curl -s -X POST https://beta.<domain>/api/v1/trade/quote -H 'content-type: application/json' -H 'cf-ipcountry: US' -H 'x-vercel-ip-country: US' -d '{}'` does **not** return `JURISDICTION_RESTRICTED`, because Cloudflare overwrites `CF-IPCountry` and the app ignores the Vercel header.
- [ ] **Geo gate:** over a VPN in a restricted country, the same POST returns `451` `JURISDICTION_RESTRICTED` (from the WAF rule or the app), and pages still load (browse-only).
- [ ] **Health:** `curl -s https://beta.<domain>/api/v1/health` shows `"status":"ok"` with rpc, redis and db `ok`, and `"fallbackInUse":false`.
- [ ] **Sentry:** from your machine, `npx @sentry/cli send-event -m "ovelo beta deploy check"` with `SENTRY_DSN` set (or the Sentry project's *Send test event* button). The event shows up in the `beta` environment.
- [ ] **Kill switch rehearsal:** run [kill-switch.md](../../deploy/hostinger/kill-switch.md) §1 (`OVELO_TRADING=off`), confirm `503 TRADING_UNAVAILABLE`, then switch back on.

## 9. Monitoring

- [ ] **Uptime:** an external monitor (for example UptimeRobot or Better Stack free tiers) on `https://beta.<domain>/api/v1/health` every minute. Alert on non-200, and on the keyword `"status":"ok"` missing for more than 5 minutes (degraded).
- [ ] **RPC failover alert:** a second keyword monitor alerts when `"fallbackInUse":true` lasts more than 10 minutes. The primary provider is down, and trading runs on the fallback.
- [ ] **Tunnel:** the Cloudflare *Tunnel health* notification (§3).
- [ ] **Sentry:** alert rules for new issues and for an error spike in `beta`.
- [ ] **Host:** install `host-check.sh` (in this bundle) from cron every 5 minutes. It alerts a webhook on disk above 80%, memory above 90%, or an `app` container that isn't healthy:

```bash
sudo sh -c 'umask 077; cat > /etc/ovelo/alert-webhook'      # paste a Slack or Discord webhook URL, Ctrl-D
echo '*/5 * * * * root /opt/ovelo/host-check.sh' | sudo tee /etc/cron.d/ovelo-host-check
```

  hPanel's VPS graphs (CPU, RAM, disk) are the second view.
- [ ] **Logs:** Docker keeps up to 5 × 20 MB per container. At beta traffic that's several days; check with `sudo du -sh /var/lib/docker/containers/*/`. Cap journald at `SystemMaxUse=500M` in `/etc/systemd/journald.conf`. If you need longer, ship logs to a log service; the app writes JSON lines and never logs secrets or IPs.

**Verify:** each monitor shows *up*. `sudo /opt/ovelo/host-check.sh; echo $?` prints `0`. `cat /etc/cron.d/ovelo-host-check` shows the line.

## 10. Backups and recovery

| What holds state | Where | Backup |
|---|---|---|
| Receipts, creators, invites, terms acceptances, notifications, caps ledger | Neon Postgres | Neon PITR (§5) |
| Trade idempotency (7 days), rate limits, sessions, cap reservations | Upstash Redis | Upstash backups (plan-dependent). Losing it fails closed: trading pauses until it's back |
| `/etc/ovelo/` (env files, tunnel token, current and previous digests) | the VPS | **offline encrypted copy**, below |
| Everything else | rebuilt | the image (GHCR, by digest) and the repo at the release tag |

- [ ] After every change to `/etc/ovelo/`, make an encrypted offline copy:

```bash
ssh opsadmin@<tailscale-name> 'sudo tar -C /etc -czf - ovelo' | gpg --symmetric --cipher-algo AES256 -o ovelo-etc-$(date +%F).tar.gz.gpg
```

  Store it on two offline media, with the passphrase in your password manager.
- [ ] **Tested restore** (once, and after each major change): on a scratch VPS or a local VM, `gpg -d ovelo-etc-….tar.gz.gpg | sudo tar -C /etc -xzf -`. Then check modes and owners against §4's verify line, and run `check:prod-env` against the restored `ovelo.env`.
- [ ] VPS snapshot (hPanel) before every OS release upgrade or Docker major upgrade.

## 11. Patching cadence

| What | When | How |
|---|---|---|
| Ubuntu security updates | automatic, daily | unattended-upgrades (§2.4). Reboot when `/var/run/reboot-required` exists (host-check reports it) |
| Docker Engine | monthly | `sudo apt update && sudo apt -y install --only-upgrade docker-ce docker-ce-cli containerd.io docker-compose-plugin`, then `sudo docker compose -f /opt/ovelo/docker-compose.yml ps` shows both services healthy |
| Base image (`node:24.12.0-slim` digest), cloudflared, GitHub Actions | weekly Dependabot PRs | merge → `image` workflow rebuilds, scans and signs → `deploy.sh <new digest>` |
| App dependencies | Dependabot (npm) | the same path |

## 12. Incident response

- **Stop the damage first:** [kill-switch.md](../../deploy/hostinger/kill-switch.md) (trading off, Under Attack mode, notifications off, tunnel down).
- **Bad deploy:** `sudo /opt/ovelo/rollback.sh`. It re-verifies the signature and doesn't touch the database; migrations are additive and forward-only.
- **Rotate a secret** (edit `/etc/ovelo/ovelo.env`, then `sudo docker compose -f /opt/ovelo/docker-compose.yml up -d --wait app`; in-flight requests drain first):

  | Secret | Rotation |
  |---|---|
  | `OVELO_TRADE_SECRET` | The drill in [KEY-CUSTODY.md §3](KEY-CUSTODY.md#3-ovelo_trade_secret-rotation): set `_PREVIOUS` to the current value and the new value as current, recreate, wait 20 minutes, remove `_PREVIOUS`, recreate. If leaked: new value with no previous, recreate. |
  | `OVELO_ORIGIN_SECRET` | Change the Transform Rule and `ovelo.env` **together** (each side alone fails closed: every request 403). Change the Cloudflare rule first, then recreate the app at once. |
  | Tunnel token | Zero Trust → the tunnel → *Refresh token* (or delete it and create a new tunnel). Write the new token to `/etc/ovelo/tunnel-token` (§3 commands), then `sudo docker compose -f /opt/ovelo/docker-compose.yml up -d --force-recreate cloudflared`. |
  | Neon `ovelo_app` password | Neon → Roles → reset. Update `DATABASE_URL` in `ovelo.env`, recreate. |
  | Upstash token, QStash keys, provider keys, VAPID, Telegram | Rotate in the provider's console, update `ovelo.env`, recreate. QStash: roll the signing key (current and next) first. |

- **VPS compromise suspected:** take the tunnel down (kill-switch §4), then rotate **every** secret above from a clean machine. Rebuild a new VPS from §1, restore `/etc/ovelo` from the offline copy only **after** rotating, and deploy the last good digest. User funds aren't exposed: the server holds no user keys, and every transaction needs the user's wallet signature. What an attacker on the box gets is the content of `ovelo.env`, which the rotation table covers.
- **Restore from a snapshot:** hPanel → Snapshots → restore. Then check `sudo /opt/ovelo/host-check.sh`, then `sudo cat /etc/ovelo/current`, then redeploy that digest.

## 13. Costs (per month; check current prices)

| Item | Cost |
|---|---|
| 💲 Hostinger KVM 2 VPS | the plan price at checkout (longer terms are cheaper per month; check the renewal price). Backups as included or priced in hPanel |
| Cloudflare (DNS, TLS, tunnel, WAF managed rules, the free plan's custom and rate-limiting rules) | free plan |
| Tailscale (personal) | free plan |
| GHCR (private image storage) | included in the GitHub plan's package storage (check the limits for a private repository); the VPS logs in with a `read:packages` token (§2.8) |
| Neon, Upstash, RPC, Jupiter, Sentry, Turnstile | unchanged from PRODUCTION-ENV.md (none of them depends on where the app runs) |
| SOL | **none** for hosting. Network fees are paid by users' own wallets; the M12 program deploy is a separate budget (REWRITE-PLAN §7.2) |
