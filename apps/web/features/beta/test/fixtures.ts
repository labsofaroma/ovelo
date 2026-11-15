import { randomUUID } from "node:crypto";
import { keyringFromEnv, sealAuthorization } from "@/server/auth/trade";

/** A sealed trade authorization for `taker` (needs OVELO_TRADE_SECRET in the test env). */
export function authorizationFor(
  taker: string,
  expiresAt = Date.now() + 60_000,
): string {
  return sealAuthorization(
    {
      kind: "trade",
      requestId: randomUUID(),
      taker,
      expiresAt,
      lastValidBlockHeight: 100,
      transactionVersion: 0,
      messageHashes: ["a".repeat(64)],
      receipt: {
        kind: "spot",
        basketId: null,
        inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        inAmount: "1000000",
        legs: [
          {
            mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
            inputAmount: "1000000",
            outAmount: "1",
            minimumAmount: "1",
            tx: 0,
          },
        ],
      },
    },
    keyringFromEnv(),
  );
}
