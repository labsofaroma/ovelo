# Product: Aroma

_Referenced by `.21st/DESIGN.md`._

## One line
Own real stocks on Solana from your own wallet: research them, buy single names or themed baskets, and later invest automatically every week (mainnet recurring comes with Aroma Guard, M12; until then a devnet test).

## Who it's for
1. **Crypto-native savers** who hold USDC and want equity exposure without a broker.
2. **Non-US retail investors** with poor access to US stocks.
3. **Creators and curators** who publish baskets their audience can buy in one click (Blinks).

## Surfaces
Final routes since the M9 cutover (the old `/v1/*`, `/landing`, `/app`, `/sip`, `/basket/builder` and `/orders` URLs redirect 308; the prototype APIs answer 410).

| Route | Purpose | Network | Label shown |
|---|---|---|---|
| `/` | editorial landing page | mainnet data | mainnet spot, devnet test, paper practice |
| `/markets`, `/stock/[symbol]` | catalog, research, news, charts, trade ticket | mainnet data; mainnet buy | mainnet spot purchase or paper practice (ticket) |
| `/baskets`, `/basket/[id]`, `/basket/new` | curated and creator baskets, builder | mainnet buy | mainnet spot purchase or paper practice (ticket) |
| `/invest` | recurring investing | **devnet only** | "Devnet test plans: test tokens, no real value", under a "Mainnet recurring: coming" notice that gives the reason and no date (M10, Path B) |
| `/portfolio` (activity at `/portfolio#activity`), `/watchlist` | holdings, orders and saved assets | mainnet + paper | mainnet holdings; paper practice kept in the browser |
| `/creators` | creator directory and publishing (invite-only) | mainnet | — |
| `/settings` | theme, privacy choices, what each mode does, wallet terms status | — | all three modes explained |
| `/privacy`, `/terms`, `/restricted` | legal pages and the restricted-location notice | — | — |
| `/api/v1/*`, `/actions.json` | versioned public API, Solana Actions and Blinks | mainnet (devnet for plans and the faucet) | — |

## Product rules (must)
- Always label clearly whether something is a **mainnet spot purchase**, a **devnet recurring test** or **paper practice**.
- Use only real, observed market data, with source and timestamp. Show stale or unavailable data as such.
- Funds never leave the user's wallet except in a transaction the user signed.
- Basket allocations shown must come from the SDK, not hard-coded figures.

## Never
- Invent prices, returns, testimonials or creator metrics.
- Claim mainnet recurring investing or guaranteed bundle atomicity.
- Call a fixed 30-day cadence "monthly calendar scheduling".

## North-star metric
Weekly active wallets with at least one active recurring plan (after mainnet SIP launches). Until then: weekly wallets completing a basket buy.

## Next milestones
See [docs/ROADMAP.md](docs/ROADMAP.md).
