# Product: Aroma

_Referenced by `.21st/DESIGN.md`._

## One line
Own real stocks on Solana from your own wallet: research them, buy single names or themed baskets, and (soon) invest automatically every week.

## Who it's for
1. **Crypto-native savers** who hold USDC and want equity exposure without a broker.
2. **Non-US retail investors** with poor access to US stocks.
3. **Creators and curators** who publish baskets their audience can buy in one click (Blinks).

## Surfaces
| Route | Purpose | Network |
|---|---|---|
| `/` `/landing` | editorial landing page | — |
| `/markets`, `/stock/[symbol]` | catalog, research, news, charts | mainnet data |
| `/baskets`, `/basket/[id]`, `/basket/builder` | curated and custom baskets | mainnet buy |
| `/sip` | recurring investing | **devnet only** |
| `/portfolio`, `/orders`, `/watchlist` | holdings and history | mainnet + paper |
| `/creators` | publish baskets (invite-only) | — |
| `/settings`, `/privacy`, `/terms` | | — |

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
