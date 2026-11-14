# AGENTS.md: working in this repo

Rules for human contributors and AI coding agents. _Referenced by `.21st/DESIGN.md`._

## Setup
```bash
pnpm install && pnpm dev:web
```
Node 24.12.0, pnpm 10.31.0. Copy `apps/web/.env.example` to `apps/web/.env.local`; a missing or invalid variable stops boot and `pnpm build:web` with a list of names (`AROMA_SKIP_ENV_CHECK=1` skips the build check for a local build only; refused in production). Never commit `.env*` files except `.env.example`.

## Where things go
- Server-only code → `apps/web/server/` (v1: env, logger, errors, http, redis, ratelimit, rpc, db). Import `server-only`; never import it from a client component. Product code lives in `apps/web/features/<feature>/` (server modules under `server/` or `server.ts`).
- Chain, market and basket helpers → `apps/web/lib/sdk/` (import the module itself, e.g. `@/lib/sdk/baskets/mainnet`; there is no barrel). The v1 contract client and the Pyth pieces the keeper also needs → `packages/guard` (`@aroma/guard`; TypeScript source, no build step). Nothing in `packages/guard` imports from `apps/*`.
- Contract changes → `packages/contracts/programs/aroma_guard/` (Aroma Guard v1, [docs/aroma-guard-v1.md](docs/aroma-guard-v1.md)). Then run `pnpm build:contracts && pnpm --filter @aroma/contracts idl:sync` (it writes the IDL and the Codama client into `packages/guard/src/v1/`).
- Design tokens → `packages/ui/tokens.css` (through `@aroma/ui`). Design context → `.21st/DESIGN.md`. Styling: Tailwind v4 utilities and CSS Modules; no new global CSS.

## Non-negotiables
1. **Never handle user private keys.** The server prepares transactions; wallets sign them.
2. Every state-changing API route needs a signature, an HMAC token or a bearer secret. Read bodies with `readLimitedJson`.
3. Devnet code paths must verify the devnet genesis hash. Never let a devnet keypair or secret touch mainnet.
4. No invented data in the UI (see [PRODUCT.md](PRODUCT.md)).
5. Use `bigint` or raw integer units for token amounts. Never float math on amounts that get signed.
6. Keep the IDL, the generated client and builders in `packages/guard` (`@aroma/guard`, re-exported by the web app as `@/lib/sdk/guard/v1`) and the Rust program in sync. `idl:check` and the Codama drift test fail if they drift.
7. Never commit a keypair. Program, localnet and devnet-only keys live in git-ignored paths (`packages/contracts/target/`, `.keys/`, `.e2e-local/`, `.devnet/`); agents never create, read or use the owner's deployer wallet.

## Before you open a PR
```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contracts     # if you touched the program (cargo test, clippy, both builds, IDL drift, LiteSVM)
```

## Style
TypeScript strict. Prettier for formatting. Prefer small modules; split components over about 400 lines. Use CSS Modules or the existing style files, not new global CSS.
