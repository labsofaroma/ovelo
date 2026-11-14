import { getBase58Encoder, generateKeyPairSigner } from "@solana/kit";
import { describe, expect, test } from "vitest";
import {
  assetAccountFilters,
  planAccountFilters,
  PLAN_FUNDING_MINT_OFFSET,
  PLAN_OWNER_OFFSET,
} from "./filters";
import {
  ASSET_DISCRIMINATOR,
  getPlanEncoder,
  PLAN_DISCRIMINATOR,
} from "./generated";
import { plan as planFixture } from "./test/fixtures";

describe("account filters", () => {
  test("the owner and funding mint offsets match the encoded Plan layout", async () => {
    const owner = (await generateKeyPairSigner()).address;
    const mint = (await generateKeyPairSigner()).address;
    const bytes = getPlanEncoder().encode(
      planFixture({ owner, fundingMint: mint }),
    );
    const at = (offset: bigint) =>
      bytes.slice(Number(offset), Number(offset) + 32);
    expect([...at(PLAN_OWNER_OFFSET)]).toEqual([
      ...getBase58Encoder().encode(owner),
    ]);
    expect([...at(PLAN_FUNDING_MINT_OFFSET)]).toEqual([
      ...getBase58Encoder().encode(mint),
    ]);
    const [disc, ownerFilter, mintFilter] = planAccountFilters(owner, mint);
    expect([...getBase58Encoder().encode(disc!.memcmp.bytes)]).toEqual([
      ...PLAN_DISCRIMINATOR,
    ]);
    expect(ownerFilter!.memcmp).toEqual({
      offset: 9n,
      bytes: owner,
      encoding: "base58",
    });
    expect(mintFilter!.memcmp.offset).toBe(41n);
    expect(planAccountFilters()).toHaveLength(1);
  });

  test("asset filter matches the asset discriminator", () => {
    const [filter] = assetAccountFilters();
    expect([...getBase58Encoder().encode(filter!.memcmp.bytes)]).toEqual([
      ...ASSET_DISCRIMINATOR,
    ]);
  });
});
