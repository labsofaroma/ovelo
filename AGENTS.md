# AGENTS.md: working in this repo

Rules for human contributors and AI coding agents. _Referenced by `.21st/DESIGN.md`._

## Setup
```bash
pnpm install && pnpm dev:web
```
Node 24.12.0, pnpm 10.31.0. Never commit `.env*` files except `.env.example`.

## Where things go
- Server-only code → `apps/web/lib/server/`. It must never be imported from a client component.
- Chain, market and basket helpers → `apps/web/lib/sdk/` (import as `@/lib/sdk`). There is no separate SDK package; no build step.
- Contract changes → `packages/anchor/programs/aroma_guard/`. Then run `pnpm --filter @aroma/anchor idl:sync` (it writes into `apps/web/lib/sdk/guard/`).
- Design tokens → `apps/web/styles/foundation.css`. Design context → `.21st/DESIGN.md`.

## Non-negotiables
1. **Never handle user private keys.** The server prepares transactions; wallets sign them.
2. Every state-changing API route needs a signature, an HMAC token or a bearer secret. Read bodies with `readLimitedJson`.
3. Devnet code paths must verify the devnet genesis hash. Never let a devnet keypair or secret touch mainnet.
4. No invented data in the UI (see [PRODUCT.md](PRODUCT.md)).
5. Use `bigint` or raw integer units for token amounts. Never float math on amounts that get signed.
6. Keep the IDL, the Guard builders in `lib/sdk/guard` and the Rust program in sync. CI should fail if they drift.

## Before you open a PR
```bash
pnpm --filter @aroma/web exec tsc --noEmit
pnpm test
pnpm test:anchor        # if you touched the program
```

## Style
TypeScript strict. Prettier for formatting. Prefer small modules; split components over about 400 lines. Use CSS Modules or the existing style files, not new global CSS.
