import { describe, expect, test } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  findEventAuthorityPda,
  findRecurringDelegationPda as upstreamDelegation,
  findSubscriptionAuthorityPda as upstreamAuthority,
} from "@solana/subscriptions";
import {
  findAssetPda as generatedAsset,
  findConfigPda as generatedConfig,
} from "./generated";
import {
  OVELO_GUARD_V1_PROGRAM_ID,
  BPF_LOADER_UPGRADEABLE_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./constants";
import {
  findAssetPda,
  findAssociatedTokenAddress,
  findConfigPda,
  findMockMintAuthorityPda,
  findPlanPda,
  findProgramDataAddress,
  findRecurringDelegationPda,
  findSubscriptionAuthorityPda,
  findSubscriptionsEventAuthorityPda,
  planAddresses,
} from "./pdas";
import { k, owner, usd } from "./test/fixtures";

const web3 = (seeds: Buffer[], program: string) =>
  PublicKey.findProgramAddressSync(seeds, new PublicKey(program))[0].toBase58();

describe("v1 PDAs", () => {
  test("config and asset match the generated helpers", async () => {
    expect(await findConfigPda()).toBe((await generatedConfig())[0]);
    expect(await findAssetPda(k(4))).toBe(
      (await generatedAsset({ mint: k(4) }))[0],
    );
  });

  test("plan, mock mint authority and ProgramData match an independent derivation", async () => {
    const nonce = Buffer.alloc(8);
    nonce.writeBigUInt64LE(7n);
    expect(await findPlanPda(owner.address, usd, 7n)).toBe(
      web3(
        [
          Buffer.from("plan"),
          new PublicKey(owner.address).toBuffer(),
          new PublicKey(usd).toBuffer(),
          nonce,
        ],
        OVELO_GUARD_V1_PROGRAM_ID,
      ),
    );
    expect(await findMockMintAuthorityPda(k(4))).toBe(
      web3(
        [Buffer.from("mock_mint"), new PublicKey(k(4)).toBuffer()],
        OVELO_GUARD_V1_PROGRAM_ID,
      ),
    );
    expect(await findProgramDataAddress()).toBe(
      web3(
        [new PublicKey(OVELO_GUARD_V1_PROGRAM_ID).toBuffer()],
        BPF_LOADER_UPGRADEABLE_ID,
      ),
    );
  });

  test("associated token accounts match spl-token for both token programs", async () => {
    for (const program of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      expect(
        await findAssociatedTokenAddress(owner.address, k(4), program),
      ).toBe(
        getAssociatedTokenAddressSync(
          new PublicKey(k(4)),
          new PublicKey(owner.address),
          true,
          new PublicKey(program),
        ).toBase58(),
      );
    }
  });

  test("Subscriptions PDAs match the upstream client", async () => {
    const authority = await findSubscriptionAuthorityPda(owner.address, usd);
    expect(authority).toBe(
      (await upstreamAuthority({ user: owner.address, tokenMint: usd }))[0],
    );
    expect(
      await findRecurringDelegationPda(authority, owner.address, k(1), 7n),
    ).toBe(
      (
        await upstreamDelegation({
          subscriptionAuthority: authority,
          delegator: owner.address,
          delegatee: k(1),
          nonce: 7n,
        })
      )[0],
    );
    expect(await findSubscriptionsEventAuthorityPda()).toBe(
      (await findEventAuthorityPda())[0],
    );
  });

  test("planAddresses composes them", async () => {
    const a = await planAddresses({
      owner: owner.address,
      fundingMint: usd,
      fundingTokenProgram: TOKEN_PROGRAM_ID,
      nonce: 7n,
    });
    expect(a.staging).toBe(
      await findAssociatedTokenAddress(a.plan, usd, TOKEN_PROGRAM_ID),
    );
    expect(a.recurringDelegation).toBe(
      await findRecurringDelegationPda(
        a.subscriptionAuthority,
        owner.address,
        a.plan,
        7n,
      ),
    );
  });
});
