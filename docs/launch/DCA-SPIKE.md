# DCA spike: Jupiter recurring orders for xStocks (M10 / Phase C)

Status: **Step 1 done (desk research and read-only chain facts). Stopped before Step 2**: the plan's figures and its product model differ from what Jupiter offers today (§2, §7). No transaction was sent, signed or simulated; no Jupiter account or API key was used.

## Sources

| Id | Source | Read (UTC) |
| :- | :- | :- |
| J1 | Recurring API overview, <https://developers.jup.ag/docs/recurring.md> | 2026-11-15 05:54 |
| J2 | Recurring create order, <https://developers.jup.ag/docs/recurring/create-order.md> | 2026-11-15 05:54 |
| J3 | Recurring best practices, <https://developers.jup.ag/docs/recurring/best-practices.md> | 2026-11-15 05:54 |
| J4 | Recurring execute / cancel / get orders, `…/recurring/{execute-order,cancel-order,get-recurring-orders}.md` | 2026-11-15 05:54 |
| T1 | Trigger API V2 overview, <https://developers.jup.ag/docs/trigger/index.md> | 2026-11-15 05:55 |
| T2 | Vault and deposit, <https://developers.jup.ag/docs/trigger/deposit.md> | 2026-11-15 05:55 |
| T3 | DCA create, <https://developers.jup.ag/docs/trigger/dca.md> | 2026-11-15 05:55 |
| T4 | Trigger best practices, <https://developers.jup.ag/docs/trigger/best-practices.md> | 2026-11-15 05:55 |
| T5 | Track a DCA order, <https://developers.jup.ag/docs/trigger/dca-history.md> | 2026-11-15 05:55 |
| T6 | Cancel a DCA order, <https://developers.jup.ag/docs/trigger/dca-cancel.md> | 2026-11-15 05:55 |
| T7 | Authentication, <https://developers.jup.ag/docs/trigger/authentication.md> | 2026-11-15 05:56 |
| T8 | Docs index, <https://developers.jup.ag/llms.txt> | 2026-11-15 05:54 |
| X1 | xStocks issuer catalog, `GET https://api.xstocks.fi/api/v2/public/assets?network=Solana&page=0..15&pageSize=100` (the source `lib/sdk/markets/sources/xstocks.ts` reads) | 2026-11-15 05:53 |
| C1 | `getMultipleAccounts` (`jsonParsed`, `finalized`) for all 1,517 catalog mints on `https://api.mainnet-beta.solana.com`, 16 batches, context slots **469,620,056–469,620,093** | 2026-11-15 05:56 |
| C2 | `getAccountInfo` of `DCA265Vj8a9CEuX1eb1LWRnDT7uK6q1xMipnNyatn23M` and its program-data account, same RPC, slot **469,620,095** | 2026-11-15 05:56 |
| Q1 | `GET https://lite-api.jup.ag/swap/v1/quote` (keyless, no taker), USDC → xStock, ExactIn, 50 bps, $10 and $50, first context slot **469,620,299** | 2026-11-15 05:57–05:58 |

The raw data is in [`dca-spike/xstocks-mints.csv`](./dca-spike/xstocks-mints.csv) (C1, every mint) and [`dca-spike/routes.csv`](./dca-spike/routes.csv) (Q1).

## 1. Jupiter's recurring product today

The plan was written against the **Recurring API** (`/recurring/v1`). That API is now marked *"no longer actively maintained and has been superseded by DCA"* (J1). The maintained product is **DCA inside Trigger Order API V2** (`/trigger/v2`), which in Jupiter's words "unifies … limit orders (Trigger V1) and DCA (the Recurring V1 API)" (T1). Trigger V2 is labelled **beta**: "behaviour, endpoints, and response formats may change" (T4).

The two products are built differently:

| | Recurring V1 (unmaintained) | DCA in Trigger V2 (maintained, beta) |
| :- | :- | :- |
| Where funds wait | On-chain order accounts (T1) | **"Vault accounts (custodial) by Privy, shared across orders"**: one Privy-managed vault per wallet (T1, T2) |
| Where the order lives | On chain (PDA) | **Off-chain**, "stored off-chain and private by default" (T1) |
| Auth | API key | API key **and** a wallet-signed challenge → JWT (15-min access + rotating refresh token) (T7) |
| Create | `POST /recurring/v1/createOrder` → unsigned tx; `POST /recurring/v1/execute` with the signed tx + requestId (J2, J4) | `POST /trigger/v2/deposit/craft` → unsigned **deposit** tx (wallet → vault); then `POST /trigger/v2/orders/dca` with the signed deposit, which Jupiter lands on chain ("the deposit lands on-chain during the create call") (T2, T3) |
| Cancel | `POST /recurring/v1/cancelOrder` → unsigned tx (J4) | `POST /orders/dca/cancel/{id}` → unsigned withdrawal tx, then `POST /orders/dca/confirm-cancel/{id}` with the signed tx; one-way, retry-safe (T6) |
| Withdraw | price-based orders only (J1) | part of cancel (T6) |
| List | `GET /recurring/v1/getRecurringOrders` (J4) | `GET /trigger/v2/orders/history/dca[/{id}]` (T5) |
| Order types | time-based; price-based deprecated (J1, J2) | `time_based`, `price_conditional` (T3) |
| Fills | keeper | keeper; "pays the network and priority fees for each fill", output "straight to your wallet" (T5) |

**On-chain program.**
- Neither doc set names a program ID.
- Trigger V2 has **no order program to clone**: the deposit is a token transfer into a Privy wallet, and the order exists only in Jupiter's backend (T1, T2).
- For Recurring V1, `DCA265Vj8a9CEuX1eb1LWRnDT7uK6q1xMipnNyatn23M` is Jupiter's long-standing DCA program. Its link to the Recurring V1 API comes from memory, not the docs, and would need a create transaction to confirm. On chain (C2) it is executable, owned by `BPFLoaderUpgradeab1e…`, with program data `CzZ4TUscQKuLkyn6RKdoQF27aUPuztEeYoNpLRXSypMM` and **upgrade authority `CvQZZ23qYDWF2RUpxYJ8y9K4skmuvYEEjH7fK58jtipQ`**, so it is upgradeable.

## 2. Limits: plan vs. today

| Item | Plan (§7, M10) | Recurring V1 (J2, J3) | Trigger V2 DCA (T1, T3, T4, T5) | Effect |
| :- | :- | :- | :- | :- |
| Minimum per round | $10 | **$50** per order (time-based) | $10 per round ("currently", "per-environment", $0.20 tolerance) | V2 matches the plan. V1 would make a 5-stock basket need $250 per round. |
| Minimum total | ~$20 (2 rounds) | **$100** | $10 × rounds; 2 rounds = $20 | V2 matches. V1 would raise the owner's P5 to ≥ $100 USDC. |
| Minimum rounds | 2 | 2 | 2; no fixed maximum | match |
| Interval bounds | not stated | not re-read | 60 s – 1 year (`intervalSeconds`); `beginFillAt` ≤ 30 days | V2 bounds go into the limits module. |
| Max active orders / wallet | 10 | not stated | **10** (`depositing`, `active`, `executing`, `withdrawing` count) | match; a basket uses one slot per stock |
| Jupiter fee | not stated | **0.1%** | not stated as a rate: "any swap fee is already reflected in the `outputAmount`" | V2's fee can't be shown in advance from our config. The review screen can only say "included in the amount received", or must wait for a per-round figure Jupiter reports (T5). |
| Integrator fee | none | none possible | none possible | match |
| Slippage | not stated | not re-read | **not configurable; keeper sets it per round** | the user cannot bound the price of a round; the disclosure must say so |
| Remainder | plan: shown or refused | — | "any remainder from uneven division is added to the last round" | our split must still be exact, but Jupiter's last round may differ by the remainder |
| P5 budget | ~$20 USDC + ~0.01 SOL | ≥ $100 USDC | $20 USDC; SOL for the deposit tx only (the keeper pays fills) | V2 fits the budget; the SOL rent figure needs P5 (vault ATA rent is not documented) |

## 3. Token support

- **Recurring V1:** "does not currently support Token-2022 mints" (J3). **Every xStock is Token-2022** (§4), so V1 rejects the whole catalog.
- **Trigger V2:** Token-2022 "supported, except transfer-fee or transfer-hook mints (unless whitelisted)" (T1). The parameter tables put this check on `inputMint` at the deposit step (T2, T3), while the best-practices page says, without naming a side, "Tokens with transfer-fee or transfer-hook extensions are rejected at deposit unless whitelisted" (T4).
  - Our input is USDC (classic SPL, no hook), so the deposit itself should pass.
  - Whether an **output** mint with a transfer-hook *extension* is rejected is **not documented**.
  - Whether Jupiter tests for the extension or for a non-null hook program is **not documented**.
- **Whitelist:** no published allowlist and no documented process to get on one (T1–T8). Only Jupiter can answer this, or a real deposit/craft call with a key, which is out of scope here (rule 2).

## 4. xStocks on chain (C1)

All **1,517** Solana mints in the issuer catalog (X1) exist on mainnet. All have **identical** extension layouts and authorities; a script compared the 15 fields below across every mint and found one distinct tuple:

| Field | Value (all 1,517 mints) |
| :- | :- |
| Token program | Token-2022 (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`) |
| Decimals | 8 |
| Extensions | `transferHook`, `permanentDelegate`, `pausableConfig`, `scaledUiAmountConfig`, `defaultAccountState`, `confidentialTransferMint`, `metadataPointer` (self), `tokenMetadata` |
| **Transfer hook program** | **none** (extension present, `programId: null`); hook authority `5aMNNLQJwAEeoemTEMkv5NVjqKwvvefRYCQ5Z67HFvEq` can set one at any time |
| Permanent delegate | `5aMNNLQJwAEeoemTEMkv5NVjqKwvvefRYCQ5Z67HFvEq` |
| Pausable | authority `JDq14BWvqCRFNu1krb12bcRpbGtJZ1FLEakMw6FdxJNs`; `paused: false` on all |
| Scaled UI amount | authority `S7vYFFWH6BjJyEsdrPQpqpYTqLTrPRK6KW3VwsJuRaS`; multiplier ≠ 1 on **190** mints (27 of the 37 basket stocks, e.g. AAPLx 1.00327, UNHx 1.02297); no pending change |
| Default account state | `initialized` |
| Confidential transfers | configured; `autoApproveNewAccounts: false` |
| Mint authority / freeze authority | `7pt9tkctJPK7PPNQJ77GKg8ZffSF6QxoMiCFYHxrtaCj` / `JDq14BWvqCRFNu1krb12bcRpbGtJZ1FLEakMw6FdxJNs` |
| Halted in the issuer catalog | 7: KVUEx, ENHAx, Tx, AXPx, VSTx, QRVOx, CITICx |

**The plan's statement "xStocks carry a transfer hook" is half true.** The extension is present on every mint, but no hook program is set today, so no extra-account-meta accounts or hook programs need cloning on a fork. The issuer can enable a hook, pause transfers, or change the UI multiplier at any time. For a multi-week DCA, that means a later round can behave differently from the first.

**Scaled UI amounts:** any "amount received" shown in the plans view must come from raw units together with the mint's current multiplier, not raw units alone. This is the "no invented data" rule.

## 5. Routes (Q1)

Scope: the 37 xStocks used by the curated baskets (`lib/sdk/markets/definitions.ts`), not all 1,517. At the keyless rate limit (~1.3 s per call), quoting all 1,517 twice would take about 3,000 calls; the basket stocks are the ones `/invest` offers.

- **36 of 37 route** at both $10 and $50. **NOCx: "No routes found"** at both.
- **Near-total price impact** (Jupiter's `priceImpactPct`, a fraction, shown ×100 by the trade review): BAx 0.9997, MMMx 0.9999, MRKx 0.85 / 0.97, JNJx 0.74, ABBVx 0.70 at $50, ASMLx 0.58, HONx 0.45. These pools effectively have no liquidity at $10.
- **Unknown DEXes.** Routes use DEXes that the reviewed spot swap schema does not know. Phase A/B already refuse Manifest and BisonFi. Q1 also routes through Hadron (AMZNx, GOOGLx, METAx, MSFTx, PLTRx), Kipseli, Scorch, Deriverse, ZeroFi and GoonFi V2. 12 stocks route **only** through Manifest: ABBVx, ASMLx, AVGOx, BAx, GSx, HONx, JNJx, LMTx, MAx, MMMx, MRKx, NOWx.
- **What this means for DCA.** The DCA keeper runs "a standard Jupiter swap" with its own slippage (T5). Our route review does **not** apply to keeper fills, so the Phase A/B "unknown DEX" refusal does not protect DCA rounds. A round's price is whatever the keeper's route gives.
- **AAPLx (Phase A finding).** The spot route was refused as an unsupported swap variant. For DCA that refusal is irrelevant, because we never build the fill. The route exists today (Kipseli + Whirlpool at $10, Whirlpool at $50).

## 6. Preliminary verdict per xStock

| Product | Verdict | Reason |
| :- | :- | :- |
| Recurring V1 | **likely rejected: all 1,517** | Token-2022 not supported (J3); every xStock is Token-2022 (C1). Also unmaintained (J1). |
| Trigger V2 DCA | **unknown: all 1,517** | Every xStock carries the `transferHook` extension. Jupiter rejects "transfer-hook mints (unless whitelisted)" but documents neither whether the output side is checked nor any whitelist (§3). Only a real deposit/craft + create (P5) or Jupiter can settle it. |
| — liquidity on top of that | NOCx: no route. BAx, MMMx, MRKx, JNJx, ABBVx, ASMLx, HONx: price impact ≥ 45% at $10–$50 | Not suitable for a $10 round even if accepted. |

## 7. Why Step 2 cannot run as written, and what needs a decision

Step 2 assumes an on-chain order program that a fork can clone, a create transaction that our server can decode against an IDL, and a cancel that returns funds from an order account. That describes Recurring V1, which rejects every xStock. The maintained product works differently:

1. **Custody (product and legal).** Between rounds the user's whole budget sits in a **Privy-managed custodial vault** operated for Jupiter, not in a program-owned account. That is a third party holding user funds. It changes PRODUCT.md, the COMPLIANCE disclosure and counsel's review, and it is the opposite of Aroma Guard's non-custodial design.
2. **Nothing to verify on chain beyond the deposit.** The schedule (amount per round, rounds, interval) lives in Jupiter's database. Step 4's checks ("decode the create instruction … amount per round, rounds, interval match the plan") reduce to the deposit transfer: USDC, amount and destination vault. The schedule can only be read back from Jupiter's API.
3. **Jupiter lands the deposit.** The signed deposit goes to `POST /orders/dca` and Jupiter broadcasts it (T3). Step 5's "send through our RPC, failover on identical bytes" is not possible. Our server can still byte-check the signed deposit before forwarding it.
4. **A Jupiter session per user.** Each user must sign a Jupiter challenge message, and someone must hold a 15-minute access token plus a rotating refresh token (T7). That means a second wallet prompt, plus a credential our server or browser has to store. A leaked token can cancel orders but not withdraw (T7).
5. **No fork spike.** There is no program to clone, and Jupiter's backend only sees mainnet. A fork can show only that our deposit transaction transfers USDC to an address. Create, the schedule, fills and cancel are **not provable off mainnet**.
6. **Fees and price per round are not ours to show in advance.** The swap fee is only "reflected in the output", and slippage is keeper-set and not capped (T5).
7. **Beta API.** Shapes may change (T4); zod refusal of unknown shapes (rule 9) will turn that into outages.

Options I see, for the owner to choose:

- **(a) Path B now.** Keep the devnet beta and add an honest "Mainnet recurring: coming" panel. The reason in plain words: Jupiter's on-chain recurring product doesn't support xStocks, and its current one holds funds in a custodial vault. Mainnet recurring then waits for M12 (Aroma Guard). No P5 money is spent.
- **(b) Owner P5 probe first, then decide.** Ask Jupiter, or test with the owner's key and wallet ($20 USDC, 2 rounds, one liquid xStock such as NVDAx or SPYx), whether an xStock output is accepted. If it is, build Path A on Trigger V2. That requires product and counsel sign-off on third-party custody, and Steps 2–5 would be rescoped as above.
- **(c) Something outside this prompt.** For example, a server-free "schedule a reminder, user signs each spot buy" flow on the existing trade path. That would be a new product decision.

My recommendation is **(a)**, with (b) as an optional owner probe. The custody point alone is a product and legal decision outside Phase C's scope, and nothing in Step 2 can reduce the uncertainty without mainnet.

## 8. Spot route review today (what Path B users can buy)

Run 2026-11-15 06:05–06:08 UTC. For each of the 37 basket xStocks, at $10 and $50 USDC, a live keyless `GET https://api.jup.ag/swap/v2/build` response went through the server's own route review, `fetchLegRoute` (`features/trade/server/route.ts`): zod parse; mint, amount, ExactIn, slippage and zero-fee binding; and the pinned ExactIn instruction decode.

- The taker was a freshly generated, **unfunded** public key, whose secret was never used.
- Nothing was signed, simulated or sent.
- Simulation and the settlement check need a funded wallet, so they were not run; a quote can still fail at those steps.
- Raw results: [`dca-spike/spot-route-review.csv`](./dca-spike/spot-route-review.csv).

| Result | Count | xStocks |
| :- | :- | :- |
| Accepted at $10 and $50 | 23 | AAPLx, AMDx, AMZNx, ASMLx, AVGOx, CVXx, GSx, HONx, JPMx, KOx, LLYx, MAx, MCDx, METAx, MSFTx, NFLXx, NVDAx, ORCLx, TSLAx, TSMx, UNHx, Vx, XOMx |
| Accepted at one amount only | 3 | GLDx ($50), GOOGLx ($50), SPYx ($10) |
| Refused: Jupiter build has no route | 9 | ABBVx, BAx, CRMx, JNJx, LMTx, MMMx, MRKx, NOCx, NOWx |
| Refused: unsupported swap variant (fail closed) | 2 | PLTRx (BisonFi), QQQx (GoonFi V2 / BisonFi) |

**DEXes.**
- Manifest, Hadron, Whirlpool, Raydium CLMM, Meteora DLMM, PancakeSwap and Archer passed the review.
- Routes through **BisonFi, GoonFi V2, Kipseli and Scorch** were refused as unsupported variants.
- The build API returned "no route" for several stocks that the keyless quote API (§5) did route, so the two APIs disagree.
- Routes change minute to minute. AAPLx, refused in Phase A, was accepted in this run.

**Baskets** (a basket quote fails if any leg is refused; checked per leg at $10, which is close to, but not exactly, the leg size of a real order):

- **All legs pass (9):** SOL-PAY, SOL-BRANDS, SOL-PHYS, SOL-CHIPS, SOL-LIFE, SOL-FIN, SOL-ENERGY, SOL-DIGITAL, SOL-LIFE3.
- **Blocked (10):** SOL-MAG7, SOL-CONNECT, SOL-AI and SOL-AI3 by GOOGLx (Kipseli at $10); SOL-DIG12 by GOOGLx and CRMx; SOL-CLOUD by CRMx and NOWx; SOL-HEALTH by JNJx, ABBVx and MRKx; SOL-DEF by LMTx, NOCx and PLTRx; SOL-BUILD by BAx and MMMx; SOL-CORE by QQQx and GLDx.

Follow-up (existing Phase B open item, not changed here): refresh the reviewed Jupiter swap schema for BisonFi, GoonFi V2, Kipseli and Scorch, with review. That unblocks 2 stocks fully, plus GOOGLx, GLDx and SPYx at the failing amounts. The 9 no-route stocks need liquidity, not code.
