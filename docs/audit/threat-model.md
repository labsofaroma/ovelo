# Threat model: Aroma Guard v1 (mainnet build)

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
