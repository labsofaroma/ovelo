# Aroma

A self-custody interface for tokenized securities on Solana. You can research stocks, buy single xStocks or stock baskets through Jupiter on **mainnet**, practise with paper trading, and test recurring investing (SIP/DCA) on **devnet** through the Aroma Guard program.

> ⚠️ This repository is the **prototype**. Aroma v1 is being rebuilt from the ground up; see [docs/ROADMAP.md](docs/ROADMAP.md). Recurring investing here is devnet-only and uses valueless test tokens.

## Monorepo layout

```
apps/
  web/              Next.js 15 App Router: pages, /api/v1 route handlers, middleware
    app/            route groups (app), (marketing); api/v1; actions.json
    features/       product code by feature (markets, stock, baskets, trade, invest, …)
    server/         server-only infrastructure (env, rpc, auth, db, http, telemetry)
    lib/sdk/        chain, market and basket helpers
    e2e/            Playwright suites (smoke, local mainnet fork, local validator)
  keeper/           QStash-triggered recurring-plan keeper (devnet today)
packages/
  contracts/        Aroma Guard v1 Anchor program (Rust) + LiteSVM tests
  guard/            @aroma/guard: Codama client, builders, Pyth and Jupiter helpers
  ui/               @aroma/ui: tokens.css, primitives, Brand, AssetAvatar
  config/           shared tsconfig, ESLint, Prettier and Vitest presets
docs/               architecture, protocol, operations, audit, launch runbooks
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit together.

## Requirements
- Node `24.12.0` (`.nvmrc`), pnpm `10.31.0`
- For the contract: Rust, Anchor 1.2, Agave `cargo-build-sbf` (Solana 4.x)

## Quick start
```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # fill in what you need
pnpm dev:web                                   # http://localhost:3000
```
Every variable is documented inline in `apps/web/.env.example`; copy it to `apps/web/.env.local` (its placeholders boot the app and connect to nothing). Boot and build always require `SOLANA_RPC_URL`, `DATABASE_URL`, `UPSTASH_REDIS_REST_URL`/`_TOKEN` and `AROMA_TRADE_SECRET`; real trading also needs `JUPITER_API_KEY`. `AROMA_TRADING=off` pauses trading.

## Scripts
| Command | What it does |
|---|---|
| `pnpm dev:web` | Next dev server |
| `pnpm build` | Turbo build of all packages |
| `pnpm lint` | ESLint 9 (flat config from `packages/config`) through Turbo; prototype code reports warnings, new code errors |
| `pnpm typecheck` | `tsc` for every workspace; `apps/web` also checks `tsconfig.strict.json` (new code, `noUncheckedIndexedAccess`) |
| `pnpm test` | Vitest for `packages/*`, `apps/keeper` and `apps/web/server`, plus the prototype `node:test` suites (`apps/web/tests`) |
| `pnpm format:check` | Prettier on new code (prototype paths are listed in `.prettierignore`) |
| `pnpm db:generate` / `pnpm db:migrate` | Drizzle: generate a migration from `apps/web/server/db/schema.ts` / apply migrations to `DATABASE_URL` (Neon) |
| `pnpm test:anchor` | Rust unit tests + IDL check + LiteSVM runtime tests |
| `pnpm build:anchor` | `anchor build` |

The prototype scripts that pointed at files that were never committed (`dev:mobile`, `keeper:trigger`, `dev:api-tunnel`, `devnet:create-xstocks`) were removed in M0. Planned replacements: the keeper trigger moves to `apps/keeper` on QStash (M6); devnet asset provisioning is rewritten against the v1 asset registry (M6); the mobile app and its tunnel are out of v1 scope. Tests that depend on the missing scripts are skipped with `TODO(Mx)` markers. See [AUDIT §3](docs/AUDIT.md#3-repository-tooling-and-ci).

## Docs
- [PRODUCT.md](PRODUCT.md): what Aroma is and the product rules
- [AGENTS.md](AGENTS.md): conventions for contributors and AI agents
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/aroma-guard-protocol.md](docs/aroma-guard-protocol.md): the on-chain program as deployed
- [docs/actions-and-collector.md](docs/actions-and-collector.md): Blinks + recurring keeper operations
- [docs/AUDIT.md](docs/AUDIT.md): known flaws, ranked
- [docs/CONTRACT-V1-SPEC.md](docs/CONTRACT-V1-SPEC.md): Aroma Guard v1 contract spec (ground-up rebuild)
- [docs/ROADMAP.md](docs/ROADMAP.md): v1 rebuild plan (phases and launch scope)
- [docs/REWRITE-PLAN.md](docs/REWRITE-PLAN.md): full codebase rewrite: target architecture, module-by-module mapping, milestones
- [SECURITY.md](SECURITY.md) · [CONTRIBUTING.md](CONTRIBUTING.md)

## Disclaimer
Aroma is software, not a broker or adviser. Tokenized stocks are issued by third parties (for example Backed xStocks), are not available in every jurisdiction, and carry issuer, smart-contract and market risk.
