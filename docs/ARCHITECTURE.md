# Architecture

## Overview

```
 Browser (Next.js client)            Next.js server (/api/*)                 External
 ─────────────────────────           ─────────────────────────               ─────────────────────
 Privy / wallet-adapter  ──sign──▶   middleware.ts (HTTPS, origin,           Solana mainnet RPC
 components/aroma/*                   rate limit, body size)                 Solana devnet RPC
 components/trading/*    ──fetch─▶   app/api/** route handlers  ──────────▶  Jupiter (quote/swap)
                                     lib/server/** (server-only)  ────────▶  Pyth Hermes
                                        │                                    Jito bundles
                                        ├── lib/sdk (shared logic)           Upstash Redis
                                        └── aroma_guard (devnet program) ◀── Solana Subscriptions
```

## Key flows

### Mainnet spot buy (single stock or basket)
1. The client asks `/api/trade/order` (or `/api/buy-basket`) for a quote. The server builds a Jupiter transaction and returns it with an **HMAC authorization** bound to the message hash, taker and expiry (`lib/server/trade-authorization.ts`, `AROMA_TRADE_SECRET`).
2. The wallet signs.
3. The client posts it to `/api/trade/execute`, `/api/transaction/execute` or `/api/bundles/execute`. The server checks that the HMAC matches, the message is unchanged and the taker's signature is valid, then simulates and broadcasts it (Jito bundles for multi-leg baskets).

### Devnet recurring plan (SIP)
1. `/api/recurring` builds the Subscriptions grant plus the Guard `create_plan` instructions. The owner signs.
2. The keeper (`/api/recurring/collect`, bearer-authorized) runs `execute_swap` for due plans, paying fees only.
3. `/api/recurring/revoke` and close return funds and rent.
Details: [aroma-guard-protocol.md](./aroma-guard-protocol.md), [actions-and-collector.md](./actions-and-collector.md).

### Creator baskets
A wallet signs a human-readable approval message (`lib/server/creator-auth.ts`). Publishing is gated by `CREATOR_INVITE_CODES`, and the data is stored in Redis (`creator-store.ts`).

### Market data and research
`lib/sdk` (`markets.ts`, `research.ts`, `pyth-oracle.ts`) fetches the token catalog, prices and research. Results are cached in Redis, the Next Data Cache or on disk (`lib/server/markets.ts`, `disk-cache.ts`).

## Trust boundaries
| Boundary | Protection |
|---|---|
| User funds | always signed by the user's wallet. The server never holds user keys |
| Quote → execute | HMAC + message hash + ed25519 signature check |
| Keeper | bearer secret. It signs only as fee payer; token movement is constrained by the program |
| Devnet vs mainnet | genesis-hash checks on every devnet RPC operation |
| Server secrets | env only. `client-secret-scan` test (script missing, see audit) |

## Packages
- **`apps/web/lib/sdk`** (import path `@/lib/sdk`) is the single source for Guard builders, the IDL, basket math and market adapters. It used to be a separate `@aroma/sdk` package and now lives inside the web app, with no build step.
- **`@aroma/anchor`** is the Anchor workspace. The IDL is synced into `apps/web/lib/sdk/guard/aroma_guard.json`.
