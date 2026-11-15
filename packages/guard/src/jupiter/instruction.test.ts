/**
 * The M4 validator on a REAL mainnet `route_v2` build (USDC → AAPLx through Orca Whirlpool,
 * recorded read-only in packages/contracts/tests/fixtures/jupiter-mainnet-routes.json, taker =
 * the Ovelo Guard v1 swap authority). The web app keeps its own suite for the other variants.
 */
import { describe, expect, test } from "vitest";
import {
  JUPITER_EXACT_IN_IDL,
  validateJupiterExactInInstruction as validate,
} from ".";

const DATA = "u2T6zDHErxRAS0wAAAAAAF9cFQAAAAAAZAAAAAAAAQAAAC8AABAnAAE=";
const PREFIX: [string, boolean, boolean][] = [
  ["9b427ZVg7M1nLtiwyfLxFH7FGkuBADSyvSUCLeMiVzJL", true, false],
  ["DDG7yCA226QYYbdWx6f2xGW2KejiHurtcFvprZx8hdo5", false, true],
  ["BkpM5XuoedmGW1YYynpmL8c7iCz1LtsWpWcG6Gc5B7RX", false, true],
  ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", false, false],
  ["XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", false, false],
  ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", false, false],
  ["TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", false, false],
  ["HJ4CJiZMt9JupbenBAm81VjwH1rcSt289rm2vBejsRjJ", false, true],
  ["D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf", false, false],
  ["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", false, false],
];
const accounts = PREFIX.map(([pubkey, isSigner, isWritable]) => ({
  pubkey,
  isSigner,
  isWritable,
}));
const settlement = {
  signer: PREFIX[0]![0],
  sourceTokenAccount: PREFIX[1]![0],
  destinationTokenAccount: PREFIX[7]![0],
  inputMint: PREFIX[3]![0],
  outputMint: PREFIX[4]![0],
  inputTokenProgram: PREFIX[5]![0],
  outputTokenProgram: PREFIX[6]![0],
};
const QUOTED = 1_399_903n;
const terms = (data = Uint8Array.from(Buffer.from(DATA, "base64"))) => ({
  instruction: {
    programId: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
    data,
    accounts,
  },
  inputAmount: 5_000_000n,
  quotedOutputAmount: QUOTED,
  minimumOutputAmount: QUOTED - (QUOTED * 100n) / 10_000n,
  slippageBps: 100,
  settlement,
});

describe("Jupiter ExactIn validator (moved from the web SDK in M8)", () => {
  test("accepts the recorded mainnet route_v2 with its settlement accounts", () => {
    expect(validate(terms())).toMatchObject({
      name: "route_v2",
      inputAmount: 5_000_000n,
    });
    expect(JUPITER_EXACT_IN_IDL.instructions.map((i) => i.name)).toContain(
      "route_v2",
    );
  });

  test("refuses trailing bytes, other amounts, a wrong destination and a wrong program", () => {
    const base = Uint8Array.from(Buffer.from(DATA, "base64"));
    const trailing = Uint8Array.from([...base, 0]);
    expect(() => validate(terms(trailing))).toThrow(/Trailing bytes/);
    expect(() => validate({ ...terms(), inputAmount: 4_999_999n })).toThrow(
      /differ from the reviewed quote/,
    );
    expect(() =>
      validate({
        ...terms(),
        settlement: { ...settlement, destinationTokenAccount: PREFIX[2]![0] },
      }),
    ).toThrow(/settlement differs/);
    expect(() =>
      validate({
        ...terms(),
        instruction: { ...terms().instruction, programId: PREFIX[5]![0] },
      }),
    ).toThrow(/Unsupported Jupiter swap instruction/);
    const unknown = Uint8Array.from(base);
    unknown[0] = 1;
    expect(() => validate(terms(unknown))).toThrow(
      /Unsupported Jupiter instruction variant/,
    );
    expect(() => validate(terms(base.subarray(0, 20)))).toThrow(/Truncated/);
    expect(() => validate({ ...terms(), minimumOutputAmount: QUOTED })).toThrow(
      /minimum output/,
    );
  });
});
