# Solana Actions and the Recurring Collector

Referenced by `apps/web/.env.example`.

## 1. Solana Actions (Blinks)

| Endpoint | Network | Purpose |
|---|---|---|
| `GET /actions.json` | — | rules that map `/basket/*` and `/baskets/*` to the buy action, and `/api/actions/**` to itself |
| `GET/POST /api/actions/buy-baskets/[id]` | **mainnet** | prepares an owner-signed basket buy |
| `GET/POST /api/actions/baskets/[id]` | **devnet** | prepares an owner-signed recurring-plan subscription |

The middleware sets `Access-Control-Allow-Origin: *`, `X-Action-Version: 2.4` and `X-Blockchain-Ids` (mainnet `5eykt4…` for buys, devnet `EtWTRA…` for recurring). Actions **only prepare transactions**. The user's wallet signs everything, and the server holds no user keys.

## 2. Recurring collector (keeper)

The collector finds plans that are due and submits `execute_swap` for each one. It signs only as the **fee payer**.

### Endpoints
| Call | Auth | Effect |
|---|---|---|
| `GET /api/recurring/collect` | `Authorization: Bearer $AROMA_RECURRING_EXECUTOR_SECRET` | runs a full collector pass over all due plans |
| `POST /api/recurring/collect` with body `{}` or `{"trigger":"cron"}` | same | same as GET |
| `POST /api/recurring/collect` with a plan payload | same | prepares a single plan collection |

`CRON_SECRET` is accepted as a fallback secret name, so Vercel Cron works unchanged. Secrets must be at least 32 characters.

### Required environment
| Var | Notes |
|---|---|
| `AROMA_RECURRING_RPC_URL` | must be devnet. The genesis hash is checked on prepare and on broadcast |
| `AROMA_RECURRING_EXECUTOR_SECRET` | bearer secret for the collector |
| `AROMA_RECURRING_AUTH_SECRET` | HMAC for reviewed messages, distinct from `AROMA_TRADE_SECRET` |
| `BOT_KEYPAIR` | devnet fee-payer JSON keypair. **Never a mainnet wallet** |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | **required in production** for leases, retries and journals. Without them the collector refuses to start a debit |

### Scheduling (recommended)
The GitHub Actions workflow in `.github/workflows` calls `scripts/bot.ts`, which **is missing from the repo**, so the workflow currently fails. GitHub cron is also often delayed. Use one of these instead.

**Vercel Cron** (`apps/web/vercel.json`):
```json
{ "crons": [{ "path": "/api/recurring/collect", "schedule": "*/5 * * * *" }] }
```
Set `CRON_SECRET` in Vercel; Vercel sends it as the bearer token.

**Upstash QStash** (retries + dead-letter queue):
```bash
curl -X POST "https://qstash.upstash.io/v2/schedules/https://YOUR_SITE/api/recurring/collect" \
  -H "Authorization: Bearer $QSTASH_TOKEN" \
  -H "Upstash-Cron: */5 * * * *" \
  -H "Upstash-Forward-Authorization: Bearer $AROMA_RECURRING_EXECUTOR_SECRET"
```

**Manual check:**
```bash
curl -H "Authorization: Bearer $AROMA_RECURRING_EXECUTOR_SECRET" https://YOUR_SITE/api/recurring/collect
```

### Important behaviour
- A period that is not collected **before the next period starts is skipped permanently** (program rule). Schedule the collector well within `period_seconds` and alert on failures.
- Collection is idempotent per period on-chain (`last_executed_period`). Redis leases prevent two collectors from racing.

## 3. Known contract blockers
See [AUDIT.md §1](./AUDIT.md#1-smart-contract--packagesanchorprogramsaroma_guard) and [CONTRACT-V1-SPEC.md](./CONTRACT-V1-SPEC.md). The collector is rebuilt as `apps/keeper` in v1 ([ROADMAP.md](./ROADMAP.md)).

### Verification commands
```bash
pnpm --filter @aroma/anchor test:fixtures
pnpm --filter @aroma/anchor test:build
pnpm --filter @aroma/anchor test
```
