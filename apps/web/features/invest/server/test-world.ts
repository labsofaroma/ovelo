/** Test-only v1 world for the invest server: encoded accounts on the fake chain. */
import {
  generateKeyPairSigner,
  getAddressEncoder,
  type Address,
} from "@solana/kit";
import {
  DEVNET_GENESIS_HASH,
  findAssetPda,
  findAssociatedTokenAddress,
  findConfigPda,
  NO_PERIOD,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  V1_PROGRAM_ID,
  type Plan,
} from "@ovelo/guard";
import {
  getAssetEncoder,
  getConfigEncoder,
  getPlanEncoder,
} from "@ovelo/guard/generated";
import { XSTOCKS_PYTH_FEEDS } from "@ovelo/guard/pyth";
import type { InvestNetwork } from "./cluster";
import { fakeChain, type FakeAccount } from "./test-chain";

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const enc = getAddressEncoder();

/* ----------------------------------------------------------------- account builders */

export function mintData(
  authority: Address | null,
  decimals: number,
): Uint8Array {
  const data = new Uint8Array(82);
  if (authority) {
    data[0] = 1;
    data.set(enc.encode(authority), 4);
  }
  data[44] = decimals;
  data[45] = 1;
  return data;
}

export function tokenAccountData(
  mint: Address,
  owner: Address,
  amount: bigint,
): Uint8Array {
  const data = new Uint8Array(165);
  data.set(enc.encode(mint), 0);
  data.set(enc.encode(owner), 32);
  Buffer.from(data.buffer).writeBigUInt64LE(amount, 64);
  data[108] = 1;
  return data;
}

const NONE = "11111111111111111111111111111111" as Address;
const four = (first: Address) =>
  [first, NONE, NONE, NONE] as [Address, Address, Address, Address];

export const AAPL_FEED = XSTOCKS_PYTH_FEEDS.AAPL!.equityReferenceFeedId;
export const MSFT_FEED = XSTOCKS_PYTH_FEEDS.MSFT!.equityReferenceFeedId;
const feedBytes = (hex: string) =>
  Uint8Array.from(Buffer.from(hex.slice(2), "hex"));

export type World = Awaited<ReturnType<typeof world>>;

/** A deployed v1 on the fake chain: config, test USD, two registered stocks and an owner. */
export async function world(
  options: { paused?: boolean; faucetAuthority?: Address } = {},
) {
  const chain = fakeChain();
  const signer = () => generateKeyPairSigner();
  const [owner, keeper, admin, usd, aapl, msft] = [
    await signer(),
    await signer(),
    await signer(),
    await signer(),
    await signer(),
    await signer(),
  ];
  const faucet = await generateKeyPairSigner();
  chain.accounts.set(await findConfigPda(), {
    owner: V1_PROGRAM_ID,
    data: Uint8Array.from(
      getConfigEncoder().encode({
        version: 1,
        admin: admin.address,
        keeperAuthority: { __option: "Some", value: keeper.address },
        paused: options.paused ?? false,
        allowedFundingMints: four(usd.address),
        maxSlippageBps: 300,
        maxOracleStalenessS: 60,
        catchUpWindowPeriods: 1,
        protocolFeeBps: 0,
        feeRecipient: NONE,
        maxInstallmentAmount: 500_000_000n,
        bump: 255,
        maxConfidenceBps: 200,
        treasury: admin.address,
        allowedFreezeAuthorities: four(NONE),
        allowedPermanentDelegates: four(NONE),
        allowedTransferHookPrograms: four(NONE),
        reserved: new Uint8Array(128),
      }),
    ),
  });
  chain.accounts.set(usd.address, {
    owner: TOKEN_PROGRAM_ID,
    data: mintData(options.faucetAuthority ?? faucet.address, 6),
  });
  for (const [stock, feed] of [
    [aapl, AAPL_FEED],
    [msft, MSFT_FEED],
  ] as const) {
    chain.accounts.set(stock.address, {
      owner: TOKEN_2022_PROGRAM_ID,
      data: mintData(null, 8),
    });
    chain.accounts.set(await findAssetPda(stock.address), {
      owner: V1_PROGRAM_ID,
      data: Uint8Array.from(
        getAssetEncoder().encode({
          version: 1,
          mint: stock.address,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          pythFeedId: feedBytes(feed),
          decimals: 8,
          enabled: true,
          bump: 254,
          extensions: 0n,
          scaledUiAmount: false,
          mockMintBump: 253,
          registeredAt: 1n,
          reserved: new Uint8Array(64),
        }),
      ),
    });
  }
  const ownerUsd = await findAssociatedTokenAddress(
    owner.address,
    usd.address,
    TOKEN_PROGRAM_ID,
  );
  chain.accounts.set(ownerUsd, {
    owner: TOKEN_PROGRAM_ID,
    data: tokenAccountData(usd.address, owner.address, 250_000_000n),
  });
  chain.accounts.set(owner.address, {
    owner: NONE,
    data: new Uint8Array(0),
    lamports: 1_000_000_000n,
  });
  const network: InvestNetwork = {
    cluster: "devnet",
    rpcUrl: "https://api.devnet.solana.com",
    browserRpcUrl: "https://api.devnet.solana.com",
    deployment: {
      programId: V1_PROGRAM_ID,
      fundingMint: usd.address,
      genesisHash: DEVNET_GENESIS_HASH,
    },
  };
  return {
    chain,
    owner,
    keeper,
    admin,
    usd,
    aapl,
    msft,
    faucet,
    ownerUsd,
    network,
  };
}

/** An encoded plan account for `owner`, for listing, closing and timeline tests. */
export function planAccount(
  overrides: Partial<Plan> & Pick<Plan, "owner" | "fundingMint" | "outputs">,
): FakeAccount {
  const plan: Plan = {
    discriminator: new Uint8Array(8),
    version: 1,
    nonce: 1n,
    fundingAmount: 10_000_000n,
    periodSeconds: 604_800n,
    startsAt: 1_763_000_000n,
    expiresAt: 1_763_000_000n + 4n * 604_800n,
    createdAt: 1_763_000_000n,
    periods: 4,
    executedPeriods: 0,
    skippedPeriods: 0,
    lastExecutedPeriod: NO_PERIOD,
    lastExecutedAt: 0n,
    pausedByOwner: false,
    legBitmap: 0,
    subscriptionAuthority: NONE,
    recurringDelegation: NONE,
    subscriptionInitId: 0n,
    bump: 255,
    fundingTokenProgram: TOKEN_PROGRAM_ID,
    catchUpWindowPeriods: 1,
    inProgressPeriod: NO_PERIOD,
    stagingStartBalance: 0n,
    reserved: new Uint8Array(96),
    ...overrides,
  };
  return {
    owner: V1_PROGRAM_ID,
    data: Uint8Array.from(getPlanEncoder().encode(plan)),
  };
}

/** `Program data:` log lines for v1 events, framed by the program's invoke/success lines. */
export function programLogs(...events: Uint8Array[]): string[] {
  return [
    `Program ${V1_PROGRAM_ID} invoke [1]`,
    ...events.map((e) => `Program data: ${b64(e)}`),
    `Program ${V1_PROGRAM_ID} success`,
  ];
}
