import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  AccountRole,
  generateKeyPairSigner,
  getAddressDecoder,
  type Address,
} from "@solana/kit";
import {
  closeEncodedVaaInstruction,
  encodedVaaSpace,
  encodeGuardianSet,
  ENCODED_VAA_DISCRIMINATOR,
  findGuardianSetPda,
  GUARDIAN_SET_DISCRIMINATOR,
  WORMHOLE_DISCRIMINATORS,
  WORMHOLE_PROGRAM_ID,
  writeEncodedVaaInstruction,
} from "./wormhole";
import {
  decodeReceiverConfig,
  encodePostUpdateParams,
  encodeReceiverConfig,
  findReceiverConfigPda,
  findReceiverTreasuryPda,
  PRICE_UPDATE_V2_DISCRIMINATOR,
  RECEIVER_CONFIG_DISCRIMINATOR,
  RECEIVER_DISCRIMINATORS,
} from "./receiver";

const anchor = (name: string) =>
  Uint8Array.from(createHash("sha256").update(name).digest().subarray(0, 8));
const signers = (n: number) =>
  Promise.all(Array.from({ length: n }, () => generateKeyPairSigner()));

describe("Wormhole and receiver instruction layouts", () => {
  test("discriminators are sha256 of the Anchor names", () => {
    expect(WORMHOLE_DISCRIMINATORS.initEncodedVaa).toEqual(
      anchor("global:init_encoded_vaa"),
    );
    expect(WORMHOLE_DISCRIMINATORS.writeEncodedVaa).toEqual(
      anchor("global:write_encoded_vaa"),
    );
    expect(WORMHOLE_DISCRIMINATORS.verifyEncodedVaaV1).toEqual(
      anchor("global:verify_encoded_vaa_v1"),
    );
    expect(WORMHOLE_DISCRIMINATORS.closeEncodedVaa).toEqual(
      anchor("global:close_encoded_vaa"),
    );
    expect(RECEIVER_DISCRIMINATORS.postUpdate).toEqual(
      anchor("global:post_update"),
    );
    expect(RECEIVER_DISCRIMINATORS.reclaimRent).toEqual(
      anchor("global:reclaim_rent"),
    );
    expect(ENCODED_VAA_DISCRIMINATOR).toEqual(anchor("account:EncodedVaa"));
    expect(GUARDIAN_SET_DISCRIMINATOR).toEqual(anchor("account:GuardianSet"));
    expect(RECEIVER_CONFIG_DISCRIMINATOR).toEqual(anchor("account:Config"));
    expect(PRICE_UPDATE_V2_DISCRIMINATOR).toEqual(
      anchor("account:PriceUpdateV2"),
    );
  });

  test("write and post data are Borsh (u32 LE lengths)", async () => {
    const [a] = await signers(1);
    const ix = writeEncodedVaaInstruction({
      writeAuthority: a!,
      encodedVaa: a!.address,
      index: 300,
      data: Uint8Array.of(7, 8),
    });
    expect([...ix.data!]).toEqual([
      ...WORMHOLE_DISCRIMINATORS.writeEncodedVaa,
      44,
      1,
      0,
      0,
      2,
      0,
      0,
      0,
      7,
      8,
    ]);
    expect(() =>
      writeEncodedVaaInstruction({
        writeAuthority: a!,
        encodedVaa: a!.address,
        index: 0,
        data: new Uint8Array(),
      }),
    ).toThrow();
    const post = encodePostUpdateParams({
      message: Uint8Array.of(1, 2, 3),
      proof: [new Uint8Array(20).fill(5)],
      treasuryId: 3,
    });
    expect([...post.subarray(8)]).toEqual([
      3,
      0,
      0,
      0,
      1,
      2,
      3,
      1,
      0,
      0,
      0,
      ...new Array(20).fill(5),
      3,
    ]);
    expect(() =>
      encodePostUpdateParams({
        message: Uint8Array.of(1),
        proof: [new Uint8Array(19)],
        treasuryId: 0,
      }),
    ).toThrow();
    expect(() =>
      encodePostUpdateParams({
        message: Uint8Array.of(1),
        proof: [],
        treasuryId: 256,
      }),
    ).toThrow();
    const close = closeEncodedVaaInstruction({
      writeAuthority: a!,
      encodedVaa: a!.address,
    });
    expect(close.accounts![0]!.role).toBe(AccountRole.WRITABLE_SIGNER);
    expect(encodedVaaSpace(100)).toBe(146);
    expect(() => encodedVaaSpace(0)).toThrow();
  });

  test("PDAs: guardian set index is big-endian; config and treasury seeds", async () => {
    // Devnet's real guardian set 1 and receiver config / treasury 0 (read-only, 2026-11-14).
    expect(await findGuardianSetPda(1)).toBe(
      "8d9szTd157GKCLcxBqiLUgB7mek3v65rbsy2ErRyjwQ5",
    );
    expect(await findReceiverConfigPda()).toBe(
      "DaWUKXCyXsnzcvLUyeJRWou8KTn7XtadgTsdhJ6RHS7b",
    );
    expect(await findReceiverTreasuryPda(0)).toBe(
      "8hQfT7SVhkCrzUSgBq6u2wYEt1sH3xmofZ5ss3YaydZW",
    );
    await expect(findReceiverTreasuryPda(256)).rejects.toThrow();
  });

  test("receiver config and guardian set encoders round-trip / have the upstream size", async () => {
    const [g, t] = await signers(2);
    const config = {
      governanceAuthority: g!.address,
      targetGovernanceAuthority: t!.address,
      wormhole: WORMHOLE_PROGRAM_ID,
      validDataSources: [
        {
          chain: 26,
          emitter: getAddressDecoder().decode(
            new Uint8Array(32).fill(0xe1),
          ) as Address,
        },
      ],
      singleUpdateFeeLamports: 1n,
      minimumSignatures: 5,
    };
    expect(decodeReceiverConfig(encodeReceiverConfig(config))).toEqual(config);
    const none = { ...config, targetGovernanceAuthority: null };
    expect(decodeReceiverConfig(encodeReceiverConfig(none))).toEqual(none);
    expect(() => decodeReceiverConfig(new Uint8Array(40))).toThrow(
      /receiver config/,
    );
    expect(() =>
      decodeReceiverConfig(RECEIVER_CONFIG_DISCRIMINATOR.slice()),
    ).toThrow(/truncated/);
    // Same size as devnet's guardian set 1 (5 keys, 124 bytes).
    const set = encodeGuardianSet({
      index: 1,
      keys: Array.from({ length: 5 }, () => new Uint8Array(20)),
      creationTime: 1,
      expirationTime: 0,
    });
    expect(set.length).toBe(124);
    expect(() =>
      encodeGuardianSet({
        index: 1,
        keys: [new Uint8Array(19)],
        creationTime: 0,
        expirationTime: 0,
      }),
    ).toThrow();
  });
});
