# Private beta access (Phase A, W2)

_Branch `phase-a-beta`. REWRITE-PLAN §7.3 **W2**. Nothing here is deployed._

During Phase A (`beta.<domain>`), mainnet buying is open only to invited wallets. Browsing, research, paper practice and the devnet `/v1/invest` beta stay open to everyone. Phase B switches the gate off with one variable.

## 1. Configuration

| Variable | Values | Default | Notes |
|---|---|---|---|
| `OVELO_BETA_GATE` | `on` / `off` | **on** when `NODE_ENV` or `VERCEL_ENV` is `production` (including a local `next start`); off in `next dev` and tests | `off` must be set explicitly (Phase B). An unreadable value fails closed (on); boot refuses it. |
| `OVELO_BETA_WALLETS` | comma-separated base58 wallets (≤ 500) | empty | Validated at boot; at runtime a malformed list grants nothing. |

Code: `features/beta/config.ts`, `server/env.beta.ts`.

## 2. Invites

- Table `beta_invites` (migration `0005_beta_access`): only the SHA-256 of the code, `max_uses` 1–100 (default 1), `expires_at` **NOT NULL** (1–90 days), CHECK `uses <= max_uses`. Table `beta_access`: one row per wallet, with the granting `invite_id`.
- Issued only by the admin CLI, printed once: `pnpm --filter @ovelo/web beta:invite [--days 7] [--uses 1]` (needs `DATABASE_URL`; run from a trusted machine).
- Redemption is wallet-signed: `POST /api/v1/beta/challenge { wallet, code }` → the wallet signs the message (bound to the site, the wallet and the code's SHA-256; 5-minute single-use nonce in Redis, challenge purpose `beta`) → `POST /api/v1/beta/redeem`. The nonce is consumed first, then one transaction: a conditional `UPDATE … uses < max_uses AND expires_at > now()` and the `beta_access` insert. The code is checked before the wallet: a used code is refused even for the wallet that used it; a wallet that already has access does not consume a second code. A restricted location is refused before anything is consumed.
- Proven by 25 parallel redemptions on PGlite and on the local Postgres (`features/beta/server/invites{,.postgres}.test.ts`).

## 3. Enforcement (defence in depth)

| Where | What |
|---|---|
| `middleware.ts` → `features/beta/server/edge.ts` | Every non-read request to `/api/v1/trade/quote` (body `taker`), `/api/v1/trade/submit` (the `taker` inside the **HMAC-verified** authorization) and `/api/v1/actions/baskets/:id` (body `account`), matched on a normalised path (decoding, repeated slashes, dot segments, case). The body is read from a clone, capped. The prototype's trading routes are refused outright while the gate is on. |
| Route handlers | quote and Action POST: `assertTradeAccess` (location → beta → terms); submit: beta access of the verified authorization's wallet. |
| Action GET | `disabled: true` while the gate is on (a GET names no wallet), with a link to the basket page. |
| Never gated | reads; the Action `/confirm` receipt callback; terms and redeem routes; devnet plans and faucet. |
| Failure | Database unreachable → **503 `BETA_ACCESS_UNAVAILABLE`** (fail closed). A request the edge cannot attribute to a wallet (no JSON, no `taker`/`account`, an authorization that does not verify) goes on to the handler, which parses the same bytes strictly and refuses it with the precise code (`INVALID_JSON`, `VALIDATION_FAILED`, `AUTHORIZATION_INVALID`) and checks beta access itself; no such request can quote or submit. |

Errors (`{ code, message }`): `BETA_ACCESS_REQUIRED` (403), `BETA_ACCESS_UNAVAILABLE` (503), `BETA_INVITE_INVALID` (403).

## 4. Order next to the compliance gate: location → beta access → terms

1. **Location first**: a legal block; a restricted visitor is never invited to do anything else (not even redeem an invite).
2. **Beta access second**: it decides who may use the product at all during Phase A. An uninvited wallet is never asked to sign legal terms for a product it cannot use, and terms acceptances stay a record of wallets that could actually trade.
3. **Terms third**: before the first quote, as in M9.

The server (`features/beta/server/gate.ts`) and the ticket (`TradeComplianceGate`) use the same order.

## 5. UI

- `BetaBanner` on every v1 page while the gate is on ("Private beta … invited wallets only, with small per-trade and daily limits").
- `BetaGate` in the trade ticket (stock, basket and creator basket all use it): a "Private beta" badge, an invite-code field and "Sign to redeem the invite"; a wallet that cannot sign messages is told so.

## 6. Tests

`features/beta/config.test.ts` (defaults, fail closed, path property test), `features/beta/server/invites.test.ts` (PGlite), `invites.postgres.test.ts` (local Postgres, 25 connections), `features/beta/routes.test.ts`, `server/middleware.beta.test.ts` (including a path-spelling property), `features/beta/components/BetaGate.test.tsx`, and the fork E2E `e2e/trade/beta-gate.spec.ts` (no access → refused; redeem → past the gate; used code → refused; axe light and dark).

## 7. Found and fixed while building this

The middleware decided "is this an API request" with `pathname.startsWith("/api/")`, so a spelling such as `//api/v1/trade/quote` skipped every API guard (origin, rate limit, geo, beta) at the edge. Next.js normally redirects repeated slashes and every handler re-checks, but the edge now matches a normalised path as well (`server/middleware.compliance.test.ts` pins it for the geo gate).
