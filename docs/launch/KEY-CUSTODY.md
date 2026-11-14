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
| **Devnet faucet key** (`AROMA_V1_FAUCET_KEYPAIR`) | operator | Vercel env (server-only) | regenerate | new key, transfer the test USD mint authority, redeploy | mints worthless test USD; refused on any non-devnet genesis | rotate; the daily budget and Turnstile cap abuse |
| **`AROMA_TRADE_SECRET`** (+ `_PREVIOUS`) | operator | Vercel env (server-only) | none needed (regenerate) | §3 below; at least quarterly and on staff change | forge trade authorizations; but every submit still needs the **wallet's signature** over the exact authorized bytes, so no funds move without the user. Receipts could be polluted | §3 leak path (no overlap) |
| **`AROMA_REVALIDATE_SECRET`** | operator | Vercel env | regenerate | replace and redeploy | can force cache revalidation (load, not data) | replace; rate limits cap abuse |
| **Turnstile secret** (`TURNSTILE_SECRET_KEY`) | operator | Vercel env | Cloudflare dashboard | rotate in Cloudflare, redeploy | bypass the faucet's human check (devnet test tokens) | rotate in Cloudflare |
| **QStash signing keys** (current/next) and `QSTASH_TOKEN` | operator | keeper host / Vercel env | Upstash console | Upstash "roll signing key": deploy current+next, then promote | forge keeper runs (the keeper only executes what is due on-chain) / schedule spam | roll keys in Upstash |
| **Privy** app secret / app ID | operator | Vercel env (ID is public) | Privy dashboard | rotate secret in Privy | v1 code does not use the secret | rotate in Privy; check allowed origins |
| **Provider keys** (Jupiter, RPC, Hermes, Upstash, Neon, Sentry) | operator | Vercel / keeper env | provider dashboards | rotate in the dashboard, redeploy | quota abuse, data access (Neon: receipts, creators, terms acceptances) | rotate; Neon: rotate the role password, review access logs |

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

## 3. `AROMA_TRADE_SECRET` rotation

Authorizations are `at1.<kid>.<payload>.<mac>`; `kid` is derived from the key; quotes live 60 s. Drill test: `apps/web/server/auth/trade-rotation.drill.test.ts`.

1. Generate a new value (`openssl rand -base64 48`) straight into Vercel's env UI.
2. Set `AROMA_TRADE_SECRET_PREVIOUS` = the current value, `AROMA_TRADE_SECRET` = the new one. Deploy. (Boot refuses previous = current.)
3. New quotes carry the new `kid`; in-flight quotes under the old key still verify until they expire.
4. After one quote lifetime plus the rollout (a few minutes; the Action confirm callback accepts up to 15 minutes after expiry, so wait **20 minutes** to keep Blink receipts), remove `AROMA_TRADE_SECRET_PREVIOUS` and deploy. Old tokens now fail `AUTHORIZATION_INVALID`.
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
