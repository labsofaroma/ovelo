# Self-host map: every Vercel coupling (Phase H, Step 0)

Phase H runs Aroma v1 on a Hostinger VPS behind Cloudflare, and keeps Vercel supported. This map lists every place the app depends on Vercel today, what it does, its self-host equivalent, and what goes wrong if the equivalent is done badly. It is the work list for Steps 1 to 5.

Generated on 2026-11-15 from `m11-launch` at `49067ac` with the commands in [§9](#9-how-this-list-was-generated). Re-run them before trusting this list on a later commit.

## 0. Headline findings

1. **On a self-hosted `next start` today, the production refusals don't run.** Every hard production rule keys on `VERCEL_ENV === "production"`: test switches, the fork genesis, the Jupiter stand-in, the E2E wallet, localnet, the Turnstile test secrets, required caps, the beta-gate profile, the notify worker secret, the notify test sink and `AROMA_SKIP_ENV_CHECK`. Off Vercel, `VERCEL_ENV` is unset, so a self-hosted production box would accept all of them. Only the rules that also read `NODE_ENV` (beta gate default, caps refusal, `testSwitchesAllowed`, HSTS) still hold. **Step 1 closes this with fail-closed platform detection.**
2. **Without a trusted proxy, every visitor shares one rate-limit key.** `clientIp` returns the literal `"local"` when it doesn't trust the proxy. Behind cloudflared with `AROMA_TRUST_PROXY=false`, the whole internet shares one `trade` bucket (10/min), which lets anyone lock everyone out. With `AROMA_TRUST_PROXY=true`, the app trusts `X-Real-IP` and `X-Forwarded-For`, which Cloudflare passes through from the client, so anyone can spoof them. **Neither setting is safe on self-host. Step 2 adds `cloudflare` mode, which reads only `CF-Connecting-IP`.**
3. **The country header is Vercel's.** `x-vercel-ip-country` is the only country source. Cloudflare sends `CF-IPCountry` and doesn't strip a client-supplied `x-vercel-ip-country`. So with `AROMA_TRUST_PROXY=true` behind Cloudflare, **the geo gate can be bypassed by sending one header**. Step 2 fixes this.
4. **The edge runtime isn't used anywhere.** All 38 route handlers declare `runtime = "nodejs"`, and the middleware is `runtime: "nodejs"` (Next 15.5.24). The build emits `.next/server/middleware.js` with its trace file. The fork and invest E2E and the Playwright smoke suite already run the app under `next start`, so the middleware is proven under `next start`. Under `output: "standalone"` it's not proven yet: Step 3 must show that the traced standalone bundle loads the middleware's server modules (pino, Upstash).
5. **Nothing uses Vercel Cron, `@vercel/*` packages, Edge Config, Blob or KV.** The lockfile has 0 `@vercel/` entries. Scheduled work is QStash calling public signed routes, which is platform-neutral.

## 1. Deploy environment and production flag (Step 1)

| Where (file:line) | What it does today | Self-host equivalent | Risk if wrong |
|---|---|---|---|
| `server/env.schema.ts:116` | `VERCEL_ENV` enum in the boot schema | `server/platform.ts` derives the deploy env; schema keeps `VERCEL_ENV` only as an input to it | Two sources of truth disagree |
| `server/env.schema.ts:232–253` | Refuses `AROMA_V1_ALLOW_TEST_SWITCHES`, `AROMA_V1_TEST_FORK_GENESIS`, `AROMA_V1_TEST_JUPITER_URL`, `NEXT_PUBLIC_AROMA_E2E_WALLET=true` in production | Same refusals when `platform.productionRules` | **Self-host production accepts a fork genesis or a Jupiter stand-in** (finding 1) |
| `server/env.schema.ts:388` `testSwitchesAllowed` | Off on Vercel production; on under `NODE_ENV=production` only with the opt-in | Off whenever production rules apply, on any platform | Outage simulation or the E2E wallet live in production |
| `server/env.rules.ts:25,36` `localnetRules` | Localnet, the Turnstile test secrets and the `http://` Redis loopback are refused on Vercel production | Production rules from `platform.ts` | Localnet cluster or always-pass Turnstile in production |
| `server/env.beta.ts:61` | Beta profile checks in production | Same, from `platform.ts` | Beta opens without its gate config |
| `server/env.notify.ts:90,98` | Worker secret required and test sink refused in production | Same | Unauthenticated notification worker, or deliveries to a test sink |
| `features/caps/config.ts:37` (money path) | Caps required when `NODE_ENV` **or** `VERCEL_ENV` is production | Replace the `VERCEL_ENV` read with `platform.ts`; behaviour on Vercel unchanged | Uncapped trades |
| `features/beta/config.ts:27` (money path) | Gate defaults on in production | Same, via `platform.ts` | Beta gate silently off |
| `features/invest/server/cluster.ts:71,78,125` | Localnet allowed only off Vercel production | `platform.ts` | Devnet or localnet paths on a production box (non-negotiable 3) |
| `server/db/local-neon.ts:23` | Local Neon WS proxy refused on Vercel production | `platform.ts` | DB traffic routed to a local proxy in production |
| `server/csp.ts:134` `hstsApplies` | HSTS on Vercel production; off Vercel, on any `NODE_ENV=production` | `platform.ts` (self-host beta and production send it; preview and development don't) | Preload HSTS committed from a non-production host, or missing in production |
| `app/robots.ts:9` | Disallow all on non-production Vercel | `platform.ts`: disallow unless deploy env is `production` | A beta or preview host indexed by search engines |
| `app/(app)/ui-preview/page.tsx:45` | 404 on Vercel production | `platform.ts` | Internal UI preview public in production |
| `scripts/check-env.ts:12` | Refuses `AROMA_SKIP_ENV_CHECK` on a Vercel production build | Refuse it whenever production rules apply; the image build stage sets it only for the build (Step 3) and the runtime boot validates | A production image that never validated its env |
| `server/prod-env.ts:102–106` `check:prod-env` | Validates with `VERCEL_ENV=production` forced | `--platform vercel|selfhost`; selfhost also validates `AROMA_PLATFORM`, `AROMA_DEPLOY_ENV`, `AROMA_PROXY_MODE`, `AROMA_ORIGIN_SECRET` | Owner validates a profile that isn't what runs |
| `observability/sentry-options.ts:26` | Environment = `SENTRY_ENVIRONMENT`, else `NODE_ENV` | Default from `platform.ts` deploy env; release from the image's commit label (Step 4) | Beta errors filed as production |
| `features/shared/site.ts:12` | Site URL falls back to `VERCEL_PROJECT_PRODUCTION_URL` | Self-host requires `AROMA_SITE_URL` (no fallback) | Links, Blinks and OG URLs point to localhost |
| `scripts/check-client-secrets.mjs:34`, `turbo.json:22` | `VERCEL_ENV` marked not secret; passed to turbo's cache key | Add `AROMA_PLATFORM` and `AROMA_DEPLOY_ENV` the same way | A build cached across environments |
| `features/trade/server/local.ts:8` (comment) | Documents the Vercel rule | Comment update only | None |

## 2. Client IP, protocol, host, country (Step 2)

| Where | What it does today | Self-host equivalent | Risk if wrong |
|---|---|---|---|
| `server/request-guard.ts:39–41` `trustsProxy` | `VERCEL === "1"` or `AROMA_TRUST_PROXY=true` | `AROMA_PROXY_MODE = vercel \| cloudflare \| none` | Trusting spoofable headers (finding 2) |
| `server/request-guard.ts:45–53` `clientIp` | `X-Real-IP`, then the first `X-Forwarded-For`; `"local"` if untrusted | `cloudflare`: only `CF-Connecting-IP`; `none`: socket peer or unknown | Rate limits and per-IP caps (beta, faucet, creators) bypassed, or one global bucket |
| `server/request-guard.ts:109–120` `requestProtocol` | `X-Forwarded-Proto` behind a trusted proxy | `cloudflare`: cloudflared's `X-Forwarded-Proto`, only after the origin lock | HTTPS redirect loop, or HSTS/redirect skipped |
| `server/request-guard.ts:123–147` `requestHost(name)` | `X-Forwarded-Host` behind a trusted proxy | `cloudflare`: `Host` (the tunnel keeps the public hostname) | Same-origin check passes for a forged host |
| `server/http.ts:115–142` `assertSameOrigin` | **A second copy** of the forwarded-host and forwarded-proto parsing | Use the one module | Two parsers drift; one stays spoofable |
| `features/compliance/jurisdiction.ts:16,30–37` | Country from `x-vercel-ip-country` when `trustsProxy` | `vercel`: that header; `cloudflare`: only `CF-IPCountry`, with `XX` and `T1` as unknown | **Geo gate bypass** (finding 3) |
| `features/compliance/edge.ts:47,77`, `features/compliance/server/gate.ts:23` (money path) | Call `jurisdictionOf(headers, env, policy)` | Unchanged call sites; the new module answers | None if the call stays the same |
| `features/creators/http.ts:108` | Public origin from `requestProtocol` + `requestHost` | Same module | Wrong Blink URLs |
| `features/invest/server/deps.ts:90` | Per-IP devnet limits through `clientIp` | Same module | Faucet drained from one IP |
| `middleware.ts:98–105,168,184` | Protocol, loopback check, effective origin, rate-limit key | Same module, plus the origin lock (403 `ORIGIN_REFUSED`) before anything else | Origin reachable without Cloudflare |
| `middleware.ts:274` matcher | Skips `_next/static`, `_next/image`, `icon.svg`, `favicon.ico` | Origin lock must also cover `/_next/image` (optimizer CPU, outbound fetches) | Image optimizer usable directly as a CPU sink |
| `.env.example:52–54,133`, `e2e/fork/run.ts:336`, `e2e/invest/run.ts:213` | `AROMA_TRUST_PROXY` | Boot error naming the replacement; E2E sets `AROMA_PROXY_MODE` | Silently trusting headers after the rename |
| Tests and E2E sending `x-vercel-ip-country` or `x-real-ip` (19 files) | Vercel-mode fixtures | Stay as Vercel-mode tests, unchanged (rule 8); new Cloudflare-mode tests beside them | Vercel path regresses unnoticed |

## 3. Function limits and runtime

| Where | Today on Vercel | Self-host | Risk |
|---|---|---|---|
| `maxDuration` in 7 routes: `trade/quote` 60, `trade/submit` 60, `actions/baskets/[id]` 60, `faucet` 60, `plans/submit` 60, `plans/prepare-create` 30, `plans/[pda]/prepare-close` 30 | Vercel kills the function after N s | Ignored by `next start`. No hard per-request limit exists; the route's own RPC and Jupiter timeouts apply. The SIGTERM drain (Step 3) must exceed 60 s, or a submit is cut mid-flight. The prompt's 25 s example is too short for these routes, so I propose a **65 s drain and a 75 s `stop_grace_period`** | Hung upstream holds a socket forever; a short drain cuts a trade submit (idempotency makes the retry safe, but the user sees an error) |
| Edge runtime | Not used | — | — |
| Middleware `runtime: "nodejs"` | Supported | Supported by `next start`; standalone tracing to be proven in Step 3 | Middleware fails to load, so **every gate is off**. Step 3 must fail the image build if `server/middleware.js` is missing |
| Concurrency | One request per function instance, autoscaled | One Node process, every request concurrent | Memory under E2E load decides the VPS plan (Step 8) |
| Graceful shutdown | Platform-managed | Next's standalone `server.js` exits on SIGTERM. A bounded drain needs `NEXT_MANUAL_SIG_HANDLE=true` and our own handler (Step 3) | In-flight requests cut on every deploy |

## 4. Caching, ISR and images

| Where | Today | Self-host | Risk |
|---|---|---|---|
| `unstable_cache` in `features/markets/server.ts:41`, `features/stock/server.ts:45`, `features/baskets/server.ts:50` | Vercel's shared data cache | Next's file cache under `.next/cache/fetch-cache`, local to the one instance | Read-only FS crashes cache writes, so the `.next/cache` volume is required (Step 3). Several instances would serve different data: the single-instance rule |
| `app/api/v1/revalidate/route.ts:28` `revalidateTag` | Purges Vercel's data cache | Purges the local file cache; same bearer secret | Fine on one instance |
| `app/(marketing)/(site)/og.png/route.tsx:19` `force-static` | Built once | Built once into the image | None |
| `next/image` in `features/shared/components/NextAvatarImage.tsx` and the ui-preview copy; `images.remotePatterns` from `image-hosts.mjs` | Vercel's optimizer | Next's built-in optimizer with `sharp`; results cached under `.next/cache/images` | No `sharp`: slow optimizer fallback. Unbounded cache: full disk (size-limited volume, Step 3). **`sharp` 0.35.4 is already in the lockfile** as Next's optional dependency, so it isn't new |
| Per-request CSP nonce on every page (`middleware.ts:149`) | Vercel never caches dynamic HTML | **Cloudflare must bypass the cache for HTML and `/api/*`** (Step 7) | A cached page carries a stale nonce, so its scripts are blocked or the nonce is replayed |

## 5. Scheduled work

| Where | Today | Self-host | Risk |
|---|---|---|---|
| `notifications/deliver` worker | QStash schedule calls the public route with `Upstash-Forward-Authorization: Bearer` | Unchanged; the URL is the public hostname, so it passes Cloudflare and the origin lock | Cloudflare WAF or bot rules challenge QStash, so notifications stop. The rules must exempt the signed worker path, or the Transform Rule must still add the origin header |
| Vercel Cron | Not used | — | — |

## 6. Build and config

| Where | Today | Self-host | Risk |
|---|---|---|---|
| `apps/web/vercel.json` | Install and build commands (pnpm 10.31.0) | Dockerfile with corepack pnpm 10.31.0 (Step 3); `vercel.json` stays for the Vercel path | — |
| `next.config.mjs` | No `output` | `output: "standalone"` (Step 3; Vercel ignores `output` for its own builder, to confirm and record) | — |
| `next.config.mjs` Sentry wrapper | Source maps uploaded when `SENTRY_AUTH_TOKEN` is set | Never pass the token to the image build (rule 9). Upload source maps in CI as a separate step, or not at all | Token baked into an image layer |
| `.github/workflows/*` | No Vercel step | `image.yml` added (Step 6) | — |

## 7. Docs that assume Vercel

| Where | Text | Change (Step 7) |
|---|---|---|
| `docs/launch/BETA-RUNBOOK.md:100` | Rollback: Vercel → *Instant Rollback* | Add `rollback.sh <previous digest>` |
| `docs/launch/CUTOVER-RUNBOOK.md:100` | Same | Same |
| `docs/launch/PRODUCTION-ENV.md` (4 mentions) | Vercel project, env UI | Both platforms; the new variables |
| `docs/launch/KEY-CUSTODY.md` (5 mentions) | Secrets live in Vercel env | Where each secret lives on the VPS, who can read it, rotation |
| `docs/REWRITE-PLAN.md:321` | Preview deploys need a Vercel project | Self-host has no previews; a local compose run stands in |
| `docs/AUDIT.md`, `docs/ROADMAP.md`, `docs/keeper-operations.md` | Passing mentions | Step 9 |

## 8. What doesn't change

Neon Postgres, Upstash Redis and QStash, the RPC primary and fallback, Jupiter, Hermes, Sentry and Turnstile are reached over HTTPS from either platform. Wallet signing stays in the browser, and the server holds no user keys (non-negotiable 1). Nothing here touches the program (`packages/contracts/programs/**`).

## 9. How this list was generated

From the repo root, on `49067ac`:

```bash
git grep -n -I -E 'VERCEL' -- apps packages scripts turbo.json ':!*.test.ts' ':!*.md' ':!apps/web/e2e' ':!apps/web/.env.example'
git grep -n -I -i 'x-vercel-' -- apps ':!*.test.ts' ':!apps/web/e2e'
git grep -n -I -E 'AROMA_TRUST_PROXY|x-forwarded-|x-real-ip' -- apps ':!*.test.ts' ':!*.md'
git grep -n -I 'maxDuration' -- apps
git grep -n -I -E "runtime *[:=] *['\"](edge|experimental-edge)" -- apps          # no match
git grep -l 'export const runtime = "nodejs"' -- apps/web/app | wc -l              # 38 of 38 routes
git grep -n -I -E 'unstable_cache\(|revalidateTag\(|force-static' -- apps/web ':!*.test.ts'
git grep -n -I 'from "next/image"' -- apps/web
git grep -n -I -E 'vercel\.json|@vercel/' -- . ':!pnpm-lock.yaml' ':!docs'; grep -c '@vercel/' pnpm-lock.yaml   # 0
git grep -n -I -i -E 'instant rollback|preview deploy|vercel →' -- docs
grep -rn -E "(clientIp|trustsProxy|requestProtocol|requestHost|requestHostname|jurisdictionOf|assertSameOrigin)\(" apps/web/{app,features,server,lib,middleware.ts} | grep -v '\.test\.'
```
