/**
 * Where Ovelo Guard v1 is deployed. Filled in from the owner's deploy output
 * (docs/M6-DEVNET-DEPLOY.md, "What to paste back"); `null` means not deployed there yet. The
 * web app must not offer a v1 flow on a cluster whose entry is null.
 */
import { address, type Address } from "@solana/kit";
import { OVELO_GUARD_V1_PROGRAM_ID } from "./constants";

/** A registered asset: its mint and the `["asset", mint]` account. */
export type V1DeployedAsset = {
  mint: Address;
  asset: Address;
  /** Pyth price feed id (hex, no 0x). */
  pythFeedId: string;
  registerSignature: string;
};

export type V1Deployment = {
  cluster: "devnet" | "mainnet";
  genesisHash: string;
  programId: Address;
  /** Signature of the deploy transaction, for the record. */
  deploySignature: string;
  /** Upgrade authority = config admin (the owner's deployer; public key only). */
  upgradeAuthority: Address;
  /** The `["config"]` account. */
  config: Address;
  initializeSignature: string;
  keeperAuthority: Address;
  treasury: Address;
  /** Test USD (devnet) or USDC (mainnet). */
  fundingMint: Address;
  /** Devnet only: the faucet key that is the test USD's mint authority. */
  fundingMintAuthority?: Address;
  /** Keyed by symbol. */
  assets: Record<string, V1DeployedAsset>;
};

export const DEVNET_GENESIS_HASH =
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const MAINNET_GENESIS_HASH =
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

/**
 * Devnet: deployed 2026-11-14 (M6), verified by `devnet:audit` (passed, 0 transactions) and by
 * decoding every account. Mainnet: not deployed (M10).
 */
export const V1_DEPLOYMENTS: Record<"devnet" | "mainnet", V1Deployment | null> =
  {
    devnet: {
      cluster: "devnet",
      genesisHash: DEVNET_GENESIS_HASH,
      programId: address("FYrrfhrysaGUwCNyTggqyKmTWqpg3vph8gzmSWt7QtTU"),
      deploySignature:
        "2BrA49sugG85LQDE8oyTMzsSfSZttcvgFv1uKiv8ercRDAk1QDXppZHxvJRwCRe55VowgJdXax2eQJqwgGvwqeaM",
      upgradeAuthority: address("4xAGiZM4st6S94f9sEHzLdyQ8k9Wj71rPrtcj8kGgoha"),
      config: address("4RkxYfgq7vFE1BNt4b2DYy27kqh9M9eQpbEYeBx4uzox"),
      initializeSignature:
        "2xsXwoD6NcV177QSppSqMJWvcfCcphQrGAYph72Ggaz5SQAzrQ1QHaiM61AK8jLPhJ8yJhhBAkakiH6eo9f8RjrJ",
      keeperAuthority: address("7qMWtAzRCnKR63GawKbGME4NdfLHHHoCtzWCdYXoio2j"),
      treasury: address("4xAGiZM4st6S94f9sEHzLdyQ8k9Wj71rPrtcj8kGgoha"),
      fundingMint: address("2s5AcNQaXiC3GNCqK8Wh7XK8hE3pzB22KtQbMn8DZEZu"),
      fundingMintAuthority: address(
        "JBfNfBJcAtrSmvPyre8AfHWphi3LqYFfaZgSnMYHbnrG",
      ),
      assets: {
        xAAPL: {
          mint: address("3cc8PuuqcsDBmThZDy1sNdpRTpuS2yvQFF5xC69tAdpc"),
          asset: address("DfvX3rB6NvEAJ5ggViz8R8LZvjF5atbWsPkJJe2nA2tW"),
          pythFeedId:
            "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688",
          registerSignature:
            "21c5jVUTb6ykKcEYFkqzcDRCtE2Ca3ZGD1RGKM2mc62qFXw5BXaALYkJ83sTQ69tjw4i3ZZNhCW43ug2VsnYJkpd",
        },
        xMSFT: {
          mint: address("3atQKQbc444RkvaPf9LNq6HePgVxqjnYYTxPao7gHjga"),
          asset: address("EaZZ13udLjMcsqFzP1qJEoCYWYskdHujsUsrx3JkX7pi"),
          pythFeedId:
            "d0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1",
          registerSignature:
            "8Xg2NV1NCWeLBmBa3S4DCUCD1dDZbfy2jMGHq9rNWQqJfwHJ92qX1YNdPtpM3ixUtjaXg5jRdb5ypzpcTa3HoQY",
        },
        xNVDA: {
          mint: address("BM4ccDkz51k8wVvxYEnWczWeQZPMyGM6BRD4UJTDmTAy"),
          asset: address("7KegVrhfFy3cqk1wSoHuv4cz1C2baXoHX4BdXG3CMGDh"),
          pythFeedId:
            "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593",
          registerSignature:
            "8VzxnRCL3dqo61quqPZ5uYwsAGbnh1asA1aMbfhuwK5aA3UKSYFUZ6NDT8K3fB1w8wwEX6Z26tJ23SSB1SdaDZM",
        },
      },
    },
    mainnet: null,
  };

/** The expected v1 program ID for every cluster (one keypair, one ID). */
export const V1_PROGRAM_ID: Address = OVELO_GUARD_V1_PROGRAM_ID;
