import { address, createNoopSigner, type Address } from "@solana/kit";
import type { Plan } from "../generated";
import { NO_PERIOD } from "../constants";

export const k = (seed: number): Address =>
  // Deterministic valid base58 addresses for tests.
  address(
    [
      "11111111111111111111111111111112",
      "So11111111111111111111111111111111111111112",
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
      "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
      "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
      "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
      "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
    ][seed]!,
  );

export const owner = createNoopSigner(k(0));
export const usd = k(2);
export const stocks = [k(4), k(5), k(6)];

export function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    discriminator: new Uint8Array(8),
    version: 1,
    owner: owner.address,
    fundingMint: usd,
    nonce: 7n,
    fundingAmount: 30_000_000n,
    periodSeconds: 86_400n,
    startsAt: 1_000n,
    expiresAt: 1_000n + 4n * 86_400n,
    createdAt: 1_000n,
    periods: 4,
    executedPeriods: 0,
    skippedPeriods: 0,
    lastExecutedPeriod: NO_PERIOD,
    lastExecutedAt: 0n,
    pausedByOwner: false,
    legBitmap: 0,
    subscriptionAuthority: k(1),
    recurringDelegation: k(3),
    subscriptionInitId: 5n,
    bump: 255,
    fundingTokenProgram: address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    catchUpWindowPeriods: 1,
    inProgressPeriod: NO_PERIOD,
    stagingStartBalance: 0n,
    outputs: stocks.map((mint, i) => ({
      mint,
      weightBps: [3_334, 3_333, 3_333][i]!,
      maxSlippageBps: 100,
    })),
    reserved: new Uint8Array(96),
    ...overrides,
  };
}
