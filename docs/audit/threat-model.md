# Threat model: Ovelo Guard v1 (mainnet build)

## Assets

1. **The owner's funding balance** (USDC in the owner's own token account), reachable only through the Subscriptions delegation that the owner approved.
2. **Staging**: the plan PDA's associated token account. It holds one installment between the pull and the last leg of a period.
3. **The owner's output**: xStocks delivered to the owner's associated token accounts.
4. **Protocol control**: config (admin, keeper, caps, allow-lists, pause) and the asset registry.

## Actors and trust

| Actor | Trusted for | Not trusted for |
|---|---|---|
| Owner | their own plan: create, pause, resume, close | anything else |
| Admin (Squads multisig on mainnet, M12) | config, pause, asset registry, keeper key | moving user funds (no instruction lets it) |
| Keeper (`config.keeper_authority`, required on mainnet) | liveness: choosing *when* to execute within the schedule, and which price update in the 20-second window | **routes**, amounts, destinations: the program re-checks everything |
| Jupiter API (off-chain) | nothing | the program never trusts a route |
| Jupiter v6 program and the AMMs it calls | executing a swap | delivering a fair amount (checked against the oracle floor), touching other accounts (only the accounts passed can be reached) |
| Pyth (receiver + Wormhole guardians) | the price within the configured confidence | freshness beyond what the program checks |
| xStocks issuer (Token-2022 authorities on the allow-lists) | not abusing freeze, pause, permanent delegate | (an issuer risk the product accepts; see limitations) |

## Trust boundaries on a mainnet execution

```
keeper tx ─► execute_installment_routed
  1. config/plan checks, keeper == keeper_authority (required)
  2. first leg: Subscriptions transfer_recurring (plan PDA signs as delegatee)
       owner funding ──(exactly funding_amount)──► staging        [exact debit and credit checked]
  3. per leg:
       staging ──(fee, plan PDA signs)──► fee account
       staging ──(amount_in, plan PDA signs)──► swap-authority source ATA
       Jupiter route_v2 CPI (swap-authority PDA signs; nothing else is a signer)
         source ──► pools ──► swap-authority transit ATA ──► owner's ATA
       verify: staging −= leg_funding exactly; source and transit back to their start;
               owner's ATA += at least min_out (oracle floor)
  4. last leg: staging == its start balance
```

The plan PDA is the Subscriptions **delegatee**. It signs only two kinds of instruction: the Subscriptions pull, and SPL `transfer_checked` out of staging. It never signs the Jupiter CPI.

## Attacks considered

| # | Attack | Control | Test |
|---|---|---|---|
| A1 | Route delivers less than fair value (bad pool, sandwich) | `min_out` = oracle value of the leg's full funding × (1 − slippage); checked on the owner's balance change | `refusals: slippage failure on a later leg…` (full rollback, pull included) |
| A2 | Route pays someone else | the destination at route index 7 must be the owner's ATA (address and owner checked before the CPI); the transit must be the swap authority's ATA; only the owner's balance change counts | `a destination that is not the owner's ATA`, `a route that pays someone else…` |
| A3 | Route drains staging | staging is forbidden in the route; staging must drop by exactly the leg's funding | `a route that drains staging…` |
| A4 | Route spends more than the leg, or keeps funds | `in_amount` must equal `amount_in`; the source account must end at its start balance | `RouteTermsMismatch`, `swap_math` proptest |
| A5 | Route touches the plan's other funds or the owner's funding account | forbidden-account list (plan, config, staging, owner funding, treasury, fee, both Subscriptions accounts, its event authority and program, this program); any writable token account owned by the plan PDA; any writable swap-authority token account other than this leg's source and transit | `a route touching the plan's other funds…` |
| A6 | Abuse of the delegatee signature through a route | the plan PDA never signs the CPI; the Subscriptions accounts are forbidden in the route (a CPI can only reach accounts it is given) | design + A5 |
| A7 | Jupiter-side fees skim output | `platform_fee_bps == 0` and `positive_slippage_bps == 0` required | `route terms…` |
| A8 | Another Jupiter instruction (shared accounts, ledger, ExactOut) or a fake Jupiter | only `route_v2` (discriminator pinned), program ID and event authority pinned, program account executable | `UnsupportedRoute` cases |
| A9 | Executor picks the most favourable price in the staleness window (MEV / griefing) | keeper-only execution and a 20-second price-age cap (decision 1) | `decision 1…` cases |
| A10 | Stale, unverified, foreign or low-confidence price | receiver-owned `PriceUpdateV2`, Full verification, feed ID of the asset, age, `conf/price` | `StalePrice`, `ConfidenceTooWide`, M6 refusals |
| A11 | Issuer pauses the mint or adds a transfer hook later | live Token-2022 policy at every execution; paused mint refused | `a paused xStock mint fails closed` |
| A12 | Pull more than the schedule allows (replay, out of order, skipping in-window periods) | oldest-runnable-period rule, `leg_bitmap`, per-period Subscriptions cap with the window built into the terms | `replay`, `catch-up…`, proptests |
| A13 | Re-entrancy through Jupiter | the runtime refuses A → B → A; this program's ID is forbidden in the route | design |
| A14 | Remaining-account confusion (counts, legs out of order) | `RouteLeg.account_count` per leg; the totals must match exactly; legs ascending by mask | `leg_offsets` unit test, `InvalidRemainingAccounts` |
| A15 | Protocol fee raised to reduce what users get | fee comes out of the slippage budget: the floor is computed on the full leg funding, so a fee never lowers `min_out` (capped at 100 bps) | `fee on…` LiteSVM, `fee_never_lowers_the_floor` proptest |
| A16 | Dust or griefing on the shared swap-authority accounts | balances must return to their *starting* value, so dust can be neither used nor stolen; anyone may create the ATAs (no state) | `swap_math` cases |
| A17 | Wrong cluster / devnet key on mainnet | off-chain: the keeper refuses mainnet's genesis unless in mainnet mode with its own key | keeper tests |

## Self-host deployment (Phase H: Hostinger VPS behind Cloudflare)

The web app's own threat surface when it runs on a VPS instead of Vercel. **The server holds no user keys**: every purchase is a transaction the user signs in their own wallet. A full compromise of the VPS therefore exposes the secrets in `/etc/ovelo/` (gates, provider quotas, database contents), never the power to move user funds. Runtime contract: [launch/SELF-HOST.md](../launch/SELF-HOST.md). Owner steps: [launch/HOSTINGER-RUNBOOK.md](../launch/HOSTINGER-RUNBOOK.md).

| # | Threat | Control | Proof (test or runbook step) |
|---|---|---|---|
| S1 | **Origin bypass:** reaching the app without Cloudflare (VPS IP, another container, a leaked hostname) to skip the WAF, the geo backup and rate limits | No inbound 80/443 (ufw + Hostinger firewall, outbound-only tunnel), and the app is published on no host port. **Origin lock:** in `cloudflare` mode, every request without `x-ovelo-origin` = `OVELO_ORIGIN_SECRET` (constant-time compare) gets 403 `ORIGIN_REFUSED` before any gate. The header is stripped before routes, redacted in logs, a forbidden client-bundle name, and must differ from every other secret | `server/middleware.origin.test.ts` (every route type, fast-check property); `server/route-gates.test.ts` origin-lock column (no exemptions); `deploy-bundle.test.ts` (no `ports:`); Step 8 `verify.mjs` (64 route rows refused on the direct path); RUNBOOK §2.3, §8 |
| S2 | **Header spoofing:** forging `X-Forwarded-For`, `X-Real-IP`, `True-Client-IP`, `x-vercel-ip-country` or `CF-IPCountry` to change the rate-limit key, a per-IP cap or the country | `server/proxy.ts` is the one parser. In `cloudflare` mode the IP comes **only** from `CF-Connecting-IP` and the country **only** from `CF-IPCountry`, which Cloudflare overwrites, and only behind the origin lock. `XX` and Tor's `T1` count as unknown, so trading is refused. `vercel` mode is allowed only on Vercel; any inconsistent answer trusts nothing. `OVELO_TRUST_PROXY` refuses to boot | `server/proxy.test.ts` (each mode ignores the headers it doesn't trust; a repo grep proves one parser); fast-check property on `CF-IPCountry`; `verify.mjs` dev suite (spoofed country and XFF through the stand-in) |
| S3 | **Production rules off on self-host:** test switches, a fork genesis, a Jupiter stand-in, the E2E wallet, localnet, Turnstile test secrets or missing caps accepted because `VERCEL_ENV` is unset | `server/platform.ts` answers platform and deploy env. A production boot without an answer, or with a contradiction, is refused, and the production rules apply to self-host production and beta. The fork-E2E image carries a marker the entry point refuses under production or beta | `server/platform.test.ts` (the full table); `check:prod-env --platform selfhost`; Step 8 (the E2E image is refused under `OVELO_DEPLOY_ENV=beta`) |
| S4 | **VPS compromise** | SSH by key only, over Tailscale only; root login and passwords off; unattended security updates; fail2ban; the owner not in the `docker` group. Containers run read-only, as non-root UIDs, with `cap_drop: ALL` and `no-new-privileges`. Exposure is limited to `/etc/ovelo/` (KEY-CUSTODY §6), and **no user funds can move without user signatures**. Response: tunnel down, rotate every secret, rebuild | RUNBOOK §2, §12; `deploy-bundle.test.ts` (compose hardening); `verify.mjs` (read-only, UID, capabilities) |
| S5 | **Env-file leak** (backup, a copy left in a home directory, `docker inspect` output pasted somewhere) | One root-only directory (0700; files 0600, the tunnel token 0400 for UID 65532), checked by `deploy.sh` before every deploy. Never in the image, a build argument, the compose file, CI or the repo. Offline backups are GPG-encrypted. The migration role lives in a separate file. Rotation table | `deploy.sh` mode checks; secret scan over `deploy/**`, the Dockerfile and the workflows (`deploy-bundle.test.ts`); the image filesystem scan (Phase H final gate); RUNBOOK §4, §10, §12 |
| S6 | **Image supply chain** (a malicious base image, dependency or action) | The official `node` base pinned by digest; `cloudflared` pinned by version and digest; every action pinned by commit SHA (each release at least two weeks old); frozen lockfile; Trivy fails the build on Critical or High with a fix; SBOM and provenance attestations; Dependabot for digests and actions | `deploy-bundle.test.ts` (SHA pins, no `latest`); `image.yml` |
| S7 | **CI compromise** | **Pull model:** CI holds no SSH key, VPS address or server credential, and has no deploy job. `deploy.sh` runs only a digest **signed by `image.yml` on `main` or a `v*` tag** (cosign keyless, GitHub OIDC), and `rollback.sh` verifies again. An image that fails the scan is never signed. A compromised CI can publish an image but can't reach the server or make it run anything | `deploy-bundle.test.ts` (signature identity, no ssh/deploy in the workflow, refuses tags and other repositories); `image.yml` header |
| S8 | **Cloudflare misconfiguration:** cached HTML (a stale or shared CSP nonce), the WAF or Bot Fight Mode blocking Blinks, QStash or Telegram, a Transform Rule on the wrong host | Cache rules bypass everything except `/_next/static` and the public assets; Bot Fight Mode stays off, and any challenge rule excludes `/actions.json`, `/api/v1/actions/**` and the worker and Telegram routes. A missing or wrong Transform Rule fails **closed** (every request 403) | RUNBOOK §3 verify lines (`cf-cache-status`, different nonces per request, `actions.json` returns JSON, the worker returns the app's 401); `verify.mjs` (fresh nonce per request) |
| S9 | **Clock drift** (trade authorizations expire 60 s after the quote; blockhashes by height) | `chrony` time sync, monitored in RUNBOOK §2.4. Expiry is checked server-side against the quote's own timestamp | RUNBOOK §2.4 verify (`chronyc tracking`) |
| S10 | **Full disk** (logs, the image cache, old images) | json-file rotation (5 × 20 MB per container, also as daemon defaults); a size-limited tmpfs; the cache volume is safe to delete; `host-check.sh` alerts at 80%; journald capped | `deploy-bundle.test.ts` (rotation); RUNBOOK §9 |
| S11 | **A deploy cut mid-submit** (restart or SIGTERM during a trade) | A bounded 65 s drain, longer than the 60 s routes, with `stop_grace_period` at 75 s. The request id is claimed before broadcast, so a retry returns the stored record and never broadcasts twice | `server/graceful.test.ts` (drain, deadline, and a submit cut mid-broadcast); `verify.mjs` (SIGTERM with a request in flight, exit 0) |
| S12 | **Redirect loop or downgrade behind the tunnel** (the origin sees http) | In cloudflare mode, behind the lock, the scheme comes from Cloudflare's `X-Forwarded-Proto`, else `CF-Visitor`. HSTS with preload is sent under production rules | `server/proxy.test.ts` (CF-Visitor); `verify.mjs` (HSTS on the public host) |
