/** Localnet provisioning for the e2e run: test USD, config, three registered mock stocks, balances. */
import {
  generateKeyPairSigner,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";
import * as v1 from "../../../../apps/web/lib/sdk/guard/v1";
import { DEVNET_ASSETS, TEST_USD, feedBytes } from "./assets";
import { e2eConfig } from "./e2e-support";
import type { Connection } from "./send";
import {
  ataAddress,
  ataIx,
  createClassicMintIxs,
  createMockStockIxs,
  mintToIx,
  SCALED_MINT_SPACE,
} from "./tokens";

export type Actors = {
  deployer: KeyPairSigner;
  keeper: KeyPairSigner;
  owner: KeyPairSigner;
  treasury: KeyPairSigner;
};
export type Stock = { symbol: string; mint: Address; multiplier: number };

export async function provisionLocal(
  c: Connection,
  a: Actors,
  log: (...p: unknown[]) => void,
) {
  const usd = await generateKeyPairSigner();
  const rent82 = await c.rpc.getMinimumBalanceForRentExemption(82n).send();
  await c.send(
    a.deployer,
    createClassicMintIxs(
      a.deployer,
      usd,
      TEST_USD.decimals,
      a.deployer.address,
      rent82,
    ),
  );
  const config = e2eConfig({
    admin: a.deployer.address,
    keeper: a.keeper.address,
    usd: usd.address,
    treasury: a.treasury.address,
  });
  await c.send(a.deployer, [
    await v1.buildInitializeConfigInstruction({
      authority: a.deployer,
      params: config,
    }),
  ]);
  log(
    "config initialized: keeper",
    a.keeper.address,
    "| window",
    config.catchUpWindowPeriods,
    "| fee bps",
    config.protocolFeeBps,
  );

  const rentScaled = await c.rpc
    .getMinimumBalanceForRentExemption(BigInt(SCALED_MINT_SPACE))
    .send();
  const stocks: Stock[] = [];
  for (const asset of DEVNET_ASSETS) {
    const mint = await generateKeyPairSigner();
    const authority = await v1.findMockMintAuthorityPda(mint.address);
    await c.send(
      a.deployer,
      createMockStockIxs(
        a.deployer,
        mint,
        asset.decimals,
        authority,
        asset.multiplier,
        rentScaled,
      ),
    );
    await c.send(a.deployer, [
      await v1.buildRegisterAssetInstruction({
        admin: a.deployer,
        mint: mint.address,
        tokenProgram: v1.TOKEN_2022_PROGRAM_ID,
        pythFeedId: feedBytes(asset.feedId),
      }),
    ]);
    stocks.push({
      symbol: asset.symbol,
      mint: mint.address,
      multiplier: asset.multiplier,
    });
    log(
      "registered",
      asset.symbol,
      mint.address,
      "| Pyth",
      `${asset.underlying}/USD`,
      asset.feedId.slice(0, 12) + "…",
      "| multiplier",
      asset.multiplier,
    );
  }
  await c.send(a.deployer, [
    ataIx(a.deployer, a.owner.address, usd.address, v1.TOKEN_PROGRAM_ID),
    ataIx(a.deployer, a.treasury.address, usd.address, v1.TOKEN_PROGRAM_ID),
  ]);
  const ownerUsd = ataAddress(
    a.owner.address,
    usd.address,
    v1.TOKEN_PROGRAM_ID,
  );
  await c.send(a.deployer, [
    mintToIx(usd.address, ownerUsd, a.deployer, 1_000_000_000n),
  ]);
  await c.send(
    a.owner,
    stocks.map((s) =>
      ataIx(a.owner, a.owner.address, s.mint, v1.TOKEN_2022_PROGRAM_ID),
    ),
  );
  return {
    usd: usd.address,
    ownerUsd,
    treasuryUsd: ataAddress(
      a.treasury.address,
      usd.address,
      v1.TOKEN_PROGRAM_ID,
    ),
    config,
    stocks,
  };
}
