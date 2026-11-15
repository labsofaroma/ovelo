# Compliance gate (M9)

_Branch `launch-prep`. Implements counsel's decisions (REWRITE-PLAN §7.1 **P1**, done by the owner). Moved from M11 to M9: it must be live **before** spot trading opens. Nothing here is deployed._

Counsel decided the level of enforcement (**per P1**): IP geo-blocking at every trading entry point, terms acceptance before the first trade, and a risk disclosure on every trade review. This document says what the code enforces, where, what counsel still has to supply, and the limits.

## 1. What is enforced, and where

| Gate | Where | Behaviour |
|---|---|---|
| **Geo-blocking (edge)** | `middleware.ts` → `features/compliance/edge.ts` | Every gated POST is refused with **451** `{ code: "JURISDICTION_RESTRICTED", message }` (prototype paths: `{ error }`). Gated: `/api/v1/trade/quote`, `/api/v1/trade/submit`, `/api/v1/actions/baskets/:id` (the Action POST that builds a transaction), the prototype trade paths (`/api/actions/*`, `/api/trade/*`, `/api/transaction/execute`, `/api/bundles/execute`, `/api/buy-basket`), and on the devnet rule `/api/v1/plans/prepare-create` and `/api/v1/faucet`. Creator basket buys go through the quote route and the Action POST, so they are covered. |
| Geo-blocking (route re-check) | quote, submit and Action routes (`features/compliance/server/gate.ts`) | Same decision again inside the handler, so a middleware matcher change cannot open trading. |
| Actions switch | `server/actions-switch.ts` (`OVELO_ACTIONS`) | A Blink client may fetch the Action POST through its own servers, so `CF-IPCountry` can be the client's country, not the user's. Under the production rules the Action POST is therefore **off** unless `OVELO_ACTIONS=on` (503 `TRADING_UNAVAILABLE`; the GET shows the Action disabled with a link to the site). **Counsel decides** whether Actions may open. |
| Action metadata | `GET /api/v1/actions/baskets/:id` | A blocked or unknown location gets the metadata with `disabled: true` and `error.message`. |
| Never blocked | Action `/confirm` callback; plan close (`prepare-close`, `plans/submit`); terms routes; all GETs | Receipts for sent transactions are never lost, and a user can always exit a plan. |
| **Terms acceptance** | `POST /api/v1/compliance/terms/{challenge,accept}`; checked in the quote route and the Action POST | The wallet signs (signMessage) a message naming the terms version and the SHA-256 of their canonical text (the M5 challenge pattern, purpose `terms`, 5-minute single-use nonce, origin-bound). Stored in `terms_acceptances` (migration `0004`; renumber if M8 adds one first) with the exact signed message and the trusted country. A quote needs an acceptance of the **current version and hash**: a version bump, or an edit of the text, requires every wallet to accept again. Refusal: **403** `TERMS_REQUIRED`; the Action's message points to the site. |
| **Risk disclosure** | `features/compliance/components/RiskDisclosure.tsx` in the trade `ReviewPanel` and (Phase A) the invest `ReviewPanel` | Wraps the confirm controls of every live review (stock, basket, creator basket) and of the devnet plan review (`surface="recurring-devnet"`), so the "Sign and buy" and "Sign and create" buttons cannot exist without it. No collapse, dismiss or "don't show again". The Action description carries the same text. |
| UI states | `TradeComplianceGate` in the trade ticket | Restricted or unknown location: an honest notice, no quote button; paper practice and browsing remain. Allowed but no terms: the terms step. `GET /api/v1/compliance/status` drives it. |
| Browse | middleware → `/v1/restricted` | Only if `OVELO_COMPLIANCE_BROWSE=block`; default is browse-only. Terms and privacy stay readable. |

**Country source.** Only `x-vercel-ip-country`, and only behind the trusted proxy (`VERCEL=1` or `OVELO_TRUST_PROXY=true`, the same rule as the client IP in `server/request-guard.ts`). Without a trusted proxy the header is ignored (anyone can send it) and the country is unknown.

## 2. Configuration (not code)

`features/compliance/policy.ts`, overridden per deployment; validated at boot (`server/env.compliance.ts`) and when loaded. An invalid policy fails closed on every gated path.

| Variable | Default | Notes |
|---|---|---|
| `OVELO_COMPLIANCE_RESTRICTED_COUNTRIES` | `US` + placeholder `CU,IR,KP,SY,RU,BY` | ISO 3166-1 alpha-2, comma-separated; replaces the default. **Placeholder list: confirm with counsel.** |
| `OVELO_COMPLIANCE_MISSING_COUNTRY` | `block` | `allow` only for local development; `pnpm check:prod-env` refuses it. |
| `OVELO_COMPLIANCE_BROWSE` | `allow` | `block` rewrites v1 pages to the notice page for restricted visitors. |
| `OVELO_COMPLIANCE_DEVNET` | `block` | Devnet plan creation and the faucet (test tokens of no value). |
| `OVELO_TERMS_VERSION` | the newest entry in `features/compliance/terms.ts` | Must name a registered version. |

Mainnet trading for a restricted country cannot be configured open (the schema accepts only `block`).

## 3. Tests

- Unit: `features/compliance/{policy,jurisdiction}.test.ts`, `server/terms.test.ts` (replay, wrong wallet, other origin, old version, version bump, expiry), `server/store.postgres.test.ts` (migration 0004 on PGlite).
- Edge: `server/middleware.compliance.test.ts` (blocked, allowed, missing header, untrusted proxy, Action POST blocked with Actions headers, confirm open, devnet rule, prototype body, invalid policy, browse rewrite).
- Routes: `features/compliance/routes.test.ts` (quote, submit, Action GET/POST, status, challenge, accept).
- Components: `ReviewDisclosure.test.tsx` (the confirm control exists only inside the disclosure), `TradeComplianceGate.test.tsx`, `features/invest/components/ReviewPanel.test.tsx` (Phase A: the devnet review's confirm control is inside the `recurring-devnet` disclosure, the devnet label stays).
- Invest E2E (`e2e/invest/invest.spec.ts`, Phase A): the review shows the devnet disclosure around "Sign and create", axe clean in light and dark.
- Fork E2E: `e2e/trade/compliance.spec.ts` (runs before the purchase specs): blocked country cannot quote (UI and API), allowed country must accept the terms before the first quote, the disclosure is visible on the review, axe in light and dark.

## 4. What counsel must supply (needs counsel's final text)

1. **Terms of use** final text. Today the only version is `2026-09-13-placeholder`: the prototype terms page, ported unchanged, marked `final: false`. The boot refuses a production deployment on a `final: false` version (`server/env.terms.ts`); a beta may run on it only with `OVELO_ALLOW_PLACEHOLDER_TERMS=true` and `OVELO_DEPLOY_ENV=beta`. Add the final text as a new version in `features/compliance/terms.ts` and the terms page; every wallet re-accepts.
2. **Acceptance line** the wallet signs (placeholder: "I have read and accept these terms and the risk disclosures.", `features/compliance/server/terms.ts`).
3. **Risk disclosure** text per surface (stock, basket, creator basket, Action, devnet recurring): `features/compliance/disclosures.ts`, all placeholder; bump `DISCLOSURE_VERSION`.
4. **Final restricted-country list**, and whether sub-national regions (for example Crimea, Donetsk, Luhansk) must be blocked; that needs `x-vercel-ip-country-region` and is not implemented.
5. **Blocked-state and notice-page wording** (`JurisdictionNotice.tsx`, `/v1/restricted`, the `JURISDICTION_RESTRICTED` and `TERMS_REQUIRED` messages).
6. Whether **paper practice** and **browsing** stay open to restricted visitors (defaults: yes).
7. Whether the devnet test surfaces (plans, faucet) need the gate at all (default: blocked).

## 5. Limits (stated plainly)

- **IP geo-blocking is not identity verification.** It reads the network location the platform reports. VPNs, proxies and Tor exits defeat it; a traveller is classed by where they are, not who they are.
- The country is only as good as Vercel's geolocation. If the platform omits it, trading fails closed.
- Off Vercel, `OVELO_TRUST_PROXY=true` must be set only behind a proxy that overwrites `x-vercel-ip-country`; otherwise anyone can claim any country.
- Terms acceptance proves a wallet signed a text; it does not identify a person or their residence.
- The gate covers Ovelo's server. A user who builds and signs their own Jupiter transaction for an xStock never touches Ovelo.
- The invest wizard's review renders `<RiskDisclosure surface="recurring-devnet">` around its confirm control (wired in Phase A, branch `phase-a-beta`); its text says the devnet beta uses test tokens of no value, and the persistent "Devnet: test tokens, no real value" label stays.

## 6. M11 wording for counsel's review (draft; nothing here is final)

M11 adds surfaces that are information, not advice, and no new gate. Counsel reviews the draft wording below before the beta's public use (BETA-RUNBOOK §3) and before the public launch (CUTOVER-RUNBOOK §12). None of these surfaces opens a way around the location, beta, terms, caps or trading-switch gates: the route-gate table test (`server/route-gates.test.ts`) lists every new route with no trading gate, because none of them quotes, builds or sends a transaction.

| Surface | Draft wording (file) | Question for counsel |
|---|---|---|
| **P&L** (`/portfolio`) | "Average cost of what this wallet bought through Ovelo (exact amounts from the confirmed transactions). 1 USDC is counted as 1 USD. Holdings from anywhere else have no cost basis here." and "Realized P&L: not shown. Ovelo records purchases only, not sales." (`features/portfolio/copy.ts`) | Is a P&L view of the user's own purchases information, not advice, as worded? Should it carry a tax disclaimer ("not tax reporting")? |
| **CSV export** | Raw and display amounts of the wallet's own orders and P&L rows (`features/portfolio/pnl/csv.ts`) | Any wording needed on the file (it has none beyond column names)? |
| **Notifications** | Facts only: "Purchase confirmed: TSLAx: 25 USDC spent. Confirmed on Solana mainnet." and "[Devnet test] Recurring round ran …" (`features/notifications/copy.ts`) | Are transactional messages acceptable as worded, with no marketing? Is a Telegram chat id or a browser push subscription "personal data" under the operator's regime (treated as such: opt-in, deletable, 30-day delivery records)? |
| **Privacy notice** | New section "Notifications (optional)" (`features/marketing/content/privacy.ts`, updated 2026-11-15) | Final text. |
| **Onboarding** (`/get-started`) | The suggested basket is "a starting point, not a recommendation: Ovelo does not give investment advice", chosen by a stated rule (fewest tokens). No on-ramp or exchange is linked (`features/onboarding/copy.ts`) | Is showing one suggested basket acceptable at all? Which on-ramp providers, if any, may be linked later? |
| **Creator dashboard** | Buys, unique buyer COUNT (never a list), volume, Blink share; "Fee share: off" (`features/creators/copy.ts`) | Fine to show creators a buyer count? Any payout (5b) needs its own review first. |

**Fee share.** Option 5a (accounting only) is implemented: a ledger records each creator-basket order's notional and the share in basis points, with the fee at 0. No platform fee is charged, and boot refuses a non-zero `OVELO_PLATFORM_FEE_BPS`. A platform fee or any payout (5b) needs the owner's and counsel's sign-off, and its own reviewed change to the trade path.
