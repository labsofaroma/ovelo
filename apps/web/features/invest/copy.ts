/**
 * Copy for /invest. The mainnet panel states the reason recorded in docs/launch/DCA-SPIKE.md
 * (M10 / Phase C, Path B): no date promise, nothing that reads as available.
 */
export const investCopy = {
  devnetHeading: "Devnet test plans",
  devnetLabel: "Test tokens, no real value.",
  mainnet: {
    heading: "Mainnet recurring: coming",
    status: "Automatic recurring buys on mainnet are not available yet.",
    reasons: [
      "Jupiter's on-chain recurring orders do not support the token standard that xStocks use (Token-2022).",
      "Jupiter's newer recurring product keeps your whole budget in a custodial vault between rounds. Aroma does not offer custody of your funds.",
    ],
    plan: "Mainnet recurring is planned through Aroma Guard, Aroma's own non-custodial program, after its external audit. There is no date yet.",
    meanwhile:
      "Until then you can buy stocks and baskets on mainnet one order at a time.",
    marketsLink: "Browse markets",
  },
} as const;
