import { expect, test } from "vitest";
import { XSTOCKS_PYTH_FEEDS } from "../pyth";
import { OVELO_GUARD_V1_PROGRAM_ID } from "./constants";
import { DEVNET_GENESIS_HASH, V1_DEPLOYMENTS } from "./deployments";
import { findAssetPda, findConfigPda } from "./pdas";

const devnet = V1_DEPLOYMENTS.devnet!;

test("the devnet record is for devnet and this program", () => {
  expect(devnet.cluster).toBe("devnet");
  expect(devnet.genesisHash).toBe(DEVNET_GENESIS_HASH);
  expect(devnet.programId).toBe(OVELO_GUARD_V1_PROGRAM_ID);
  expect(devnet.programId).toBe("FYrrfhrysaGUwCNyTggqyKmTWqpg3vph8gzmSWt7QtTU");
});

test("every recorded PDA re-derives from the program and mint", async () => {
  expect(devnet.config).toBe(await findConfigPda());
  for (const [symbol, a] of Object.entries(devnet.assets))
    expect(a.asset, symbol).toBe(await findAssetPda(a.mint));
});

test("every recorded asset uses its underlying's real Pyth equity feed", () => {
  expect(Object.keys(devnet.assets).sort()).toEqual([
    "xAAPL",
    "xMSFT",
    "xNVDA",
  ]);
  for (const [symbol, a] of Object.entries(devnet.assets))
    expect(`0x${a.pythFeedId}`, symbol).toBe(
      XSTOCKS_PYTH_FEEDS[symbol.slice(1)]!.equityReferenceFeedId,
    );
});

test("devnet roles: the faucet and keeper are separate keys, never the deployer", () => {
  expect(devnet.treasury).toBe(devnet.upgradeAuthority);
  expect(devnet.fundingMintAuthority).not.toBe(devnet.upgradeAuthority);
  expect(devnet.keeperAuthority).not.toBe(devnet.upgradeAuthority);
  expect(devnet.keeperAuthority).not.toBe(devnet.fundingMintAuthority);
});
