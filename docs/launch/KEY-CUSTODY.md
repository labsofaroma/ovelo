# Key custody (P4)

_Runbook prepared on `launch-prep`. **The owner holds every key**; sessions never create, read or use the owner's deployer, multisig or mainnet keeper keys (AGENTS.md rule 7). Checks: `pnpm check:custody` (on-chain, read-only) and the secret scans (`scripts/check-client-secrets.mjs`, `server/secret-scan.m7.test.ts`)._

**Rules.** No key ever in git. Devnet and mainnet keys are never shared or reused. The mainnet deployer is funded only for the deploy and emptied afterwards. Any key suspected leaked is rotated first and investigated second.

## 1. Inventory

| Key / secret | Who holds it | Where it lives | Backup | Rotation | Blast radius if leaked | Response |
|---|---|---|---|---|---|---|
| **Program keypair** (fixes the v1 program ID `FYrrfh…QtTU`) | owner | offline (encrypted USB / hardware-backed vault); git-ignored `packages/contracts/target/deploy/` only on the build machine | two encrypted offline copies in separate places | none (the ID is the key); after deploy it signs nothing | before deploy: someone else can deploy at the ID. After deploy: none (the upgrade authority governs upgrades) | before deploy: generate a new keypair, new ID, rebuild, re-run IDL sync; after: none |
| **Devnet deployer** | owner | owner's machine, devnet only | optional | anytime: `solana program set-upgrade-authority` on devnet | devnet program upgrades and config (test tokens only) | move the devnet upgrade authority and `admin` to a new devnet key |
| **Mainnet deployer** (future, M12) | owner | **hardware wallet** (Ledger) | the hardware wallet's seed phrase, offline, two locations | single use: funded with only the deploy rent + fees, transfers the upgrade authority to Squads in the same session, then emptied | until the authority moves: full control of program upgrades | if before the handover: deploy is aborted; if after: none (holds no authority, no funds) |
| **Squads multisig** (upgrade authority + config `admin`, M12) | members (≥ 3), threshold ≥ 2 | Squads v4 vault; each member on a hardware wallet | each member's own seed backup; member list documented off-repo | add/remove members by multisig proposal; threshold change by proposal | one member key: nothing alone (threshold). Threshold of keys: program upgrade, config changes | remove the compromised member by proposal; with a **timelock** on upgrades, cancel any malicious proposal inside the window |
| **Timelock** (Squads time lock on the vault) | — | Squads config | — | by proposal | — | set ≥ 24 h before mainnet caps are raised; monitor proposals |
| **Mainnet keeper key** (`KEEPER_KEYPAIR`, M12) | owner (operator) | keeper host's secret store (not Vercel, not git) | can be regenerated; no backup needed | new key → `update_config` `keeper_authority` by multisig → redeploy keeper | can execute due installments within the program's bounds (oracle-bounded `min_out`, caps); can spend its fee SOL | set a new `keeper_authority` by multisig; drain-proof by design (holds only fee SOL; alert at `KEEPER_MIN_SOL_LAMPORTS`) |
| **Devnet keeper key** | operator | keeper secret store (devnet service) | regenerate | as above, on devnet (deployer signs) | devnet installments only; refused on mainnet genesis | new devnet key |
| **Devnet faucet key** (`OVELO_V1_FAUCET_KEYPAIR`) | operator | Vercel env (server-only), or `/etc/ovelo/ovelo.env` on the VPS (§6) | regenerate | new key, transfer the test USD mint authority, redeploy | mints worthless test USD; refused on any non-devnet genesis | rotate; the daily budget and Turnstile cap abuse |
| **`OVELO_TRADE_SECRET`** (+ `_PREVIOUS`) | operator | Vercel env (server-only), or `/etc/ovelo/ovelo.env` on the VPS (§6) | none needed (regenerate) | §3 below; at least quarterly and on staff change | forge trade authorizations; but every submit still needs the **wallet's signature** over the exact authorized bytes, so no funds move without the user. Receipts could be polluted | §3 leak path (no overlap) |
| **`OVELO_REVALIDATE_SECRET`** | operator | Vercel env or `ovelo.env` (§6) | regenerate | replace and redeploy | can force cache revalidation (load, not data) | replace; rate limits cap abuse |
| **Turnstile secret** (`TURNSTILE_SECRET_KEY`) | operator | Vercel env or `ovelo.env` (§6) | Cloudflare dashboard | rotate in Cloudflare, redeploy | bypass the faucet's human check (devnet test tokens) | rotate in Cloudflare |
| **QStash signing keys** (current/next) and `QSTASH_TOKEN` | operator | keeper host / Vercel env / `ovelo.env` (§6) | Upstash console | Upstash "roll signing key": deploy current+next, then promote | forge keeper runs (the keeper only executes what is due on-chain) / schedule spam | roll keys in Upstash |
| ~~Privy~~ | none: **removed** (REWRITE-PLAN §7.3 W1, wallet-only login); no Privy keys exist | | | | | |
| **Provider keys** (Jupiter, RPC, Hermes, Upstash, Neon, Sentry) | operator | Vercel / `ovelo.env` / keeper env | provider dashboards | rotate in the dashboard, redeploy | quota abuse, data access (Neon: receipts, creators, terms acceptances) | rotate; Neon: rotate the role password, review access logs |

## 2. M12: moving the upgrade authority to Squads, and verifying it

1. Create the Squads v4 multisig (≥ 2-of-3, members on hardware wallets), with a time lock; note the **vault** address.
2. Deploy with the mainnet deployer (hardware wallet), initialize config with `admin` = vault, `keeper_authority` = the mainnet keeper.
3. `solana program set-upgrade-authority <PROGRAM_ID> --new-upgrade-authority <VAULT>` (signed by the deployer).
4. Empty the deployer.
5. Verify (read-only, prints addresses and OK/MISMATCH):

```bash
pnpm check:custody --cluster mainnet --rpc <mainnet RPC> --require-deployed \
  --expect-upgrade-authority <VAULT> --expect-admin <VAULT> --expect-keeper <KEEPER_PUBKEY>
```

Today on devnet (program not deployed yet): `check:custody: NOT DEPLOYED … OK` (exit 0; `--require-deployed` makes it fail).

## 3. `OVELO_TRADE_SECRET` rotation

Authorizations are `at1.<kid>.<payload>.<mac>`; `kid` is derived from the key; quotes live 60 s. Drill test: `apps/web/server/auth/trade-rotation.drill.test.ts`.

1. Generate a new value (`openssl rand -base64 48`) straight into Vercel's env UI, or into your local copy of `ovelo.env` on the self-host path.
2. Set `OVELO_TRADE_SECRET_PREVIOUS` = the current value and `OVELO_TRADE_SECRET` = the new one. Deploy: on Vercel, redeploy; on self-host, install the file and recreate the container (§6). The boot refuses previous = current.
3. New quotes carry the new `kid`; in-flight quotes under the old key still verify until they expire.
4. After one quote lifetime plus the rollout (a few minutes; the Action confirm callback accepts up to 15 minutes after expiry, so wait **20 minutes** to keep Blink receipts), remove `OVELO_TRADE_SECRET_PREVIOUS` and deploy. Old tokens now fail `AUTHORIZATION_INVALID`.
5. `pnpm check:prod-env` warns while a previous key is set.

**Leak:** skip the overlap: set a new key with no previous and deploy. Every in-flight quote fails closed; users re-quote.

## 4. Devnet and mainnet separation

- Separate deployer, keeper and faucet keys per cluster; the keeper and faucet refuse any genesis but their own (devnet), checked at boot and per RPC client.
- No devnet key or secret in a mainnet environment: devnet-only variables are listed in [PRODUCTION-ENV.md §1](./PRODUCTION-ENV.md); the mainnet keeper gets its own host and secret store.
- Program, localnet and devnet-only keys live only in git-ignored paths (`packages/contracts/target/`, `.keys/`, `.e2e-local/`, `.devnet/`).

## 5. Checks

- `pnpm check:custody` — on-chain upgrade authority, config admin and keeper vs. expected (read-only).
- `pnpm check:prod-env` — the production env profile (no test or placeholder values, rotation in progress warned).
- Secret scans: `scripts/check-client-secrets.mjs` at the end of `pnpm build:web`; the repo secret scan test.

## 6. Self-host (Hostinger VPS): where each secret lives, who can read it

Phase H. On the VPS, every runtime secret is in **one root-only directory**. Nothing secret is in the image, the compose file, a build argument, CI or the repo.

| Secret | Location on the VPS | Readable by | Also held at | Rotation |
|---|---|---|---|---|
| All app secrets (`OVELO_TRADE_SECRET`, `OVELO_ORIGIN_SECRET`, notify worker, revalidate, Upstash token, QStash keys, provider keys, VAPID private, Telegram, Turnstile, the devnet faucet key, the `ovelo_app` DB password) | `/etc/ovelo/ovelo.env` (dir 0700 root, file 0600 root) | root, and through `docker inspect` anyone who can run Docker (root only: `opsadmin` is **not** in the `docker` group). Inside the container: the app process (UID 10001) | the owner's encrypted offline backup (HOSTINGER-RUNBOOK §10) | HOSTINGER-RUNBOOK §12 table: edit the file, recreate the container (drains first) |
| `OVELO_ORIGIN_SECRET` | `ovelo.env` | as above | **the Cloudflare Transform Rule**: anyone with access to the Cloudflare account. Keep members minimal, with 2FA | change the rule and the file together (each alone fails closed: every request 403) |
| Migration role DB URL | `/etc/ovelo/migrate.env` (0600 root) | root; only `deploy.sh`'s one-shot container reads it | offline backup | Neon → reset the role password, update the file |
| Cloudflare Tunnel token | `/etc/ovelo/tunnel-token` (0400, UID 65532), mounted read-only into `cloudflared` | root and the `cloudflared` process | Cloudflare Zero Trust (it can be refreshed there) | Zero Trust → *Refresh token*, rewrite the file, recreate `cloudflared` |
| Alert webhook URL | `/etc/ovelo/alert-webhook` (0600 root) | root (cron) | the Slack or Discord workspace | regenerate the webhook |
| Image signing | none on the VPS or in CI: cosign **keyless** (GitHub OIDC). The VPS verifies against the `image.yml` workflow identity | — | Sigstore's transparency log (public) | nothing to rotate. A compromised workflow identity is handled by protecting `main` and the tags |

**Who can reach the VPS:** only `opsadmin`, with an SSH key, over Tailscale. Root login and passwords are off, and ufw and the Hostinger firewall deny all other inbound traffic. **The VPS holds no user keys and no funded mainnet wallet:** a VPS compromise exposes the secrets above (rotate them all, HOSTINGER-RUNBOOK §12), but no user funds can move without each user's own wallet signature.
