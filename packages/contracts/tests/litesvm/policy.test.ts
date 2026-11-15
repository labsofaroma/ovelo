/**
 * Token-2022 policy in register_asset, re-checked at execution. Accept cases use the REAL mainnet
 * xStocks mint accounts (tests/fixtures/xstocks-mainnet-mints.json) with only the mint authority
 * swapped to the asset's mock PDA, because the devnet build registers only mints it can mint.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { address, getAddressEncoder, type Address } from "@solana/kit";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createInitializeInterestBearingMintInstruction,
  createInitializeMintCloseAuthorityInstruction,
  createInitializeNonTransferableMintInstruction,
  createInitializePausableConfigInstruction,
  createInitializePermanentDelegateInstruction,
  createInitializeTransferFeeConfigInstruction,
  createInitializeTransferHookInstruction,
  createPauseInstruction,
  createUpdateTransferHookInstruction,
} from "@solana/spl-token";
import * as v1 from "@ovelo/guard";
import { feed, kitIx, pk } from "./harness";
import { ataIx, DEFAULT, errorCode, World } from "./world";

const ISSUER = address("5aMNNLQJwAEeoemTEMkv5NVjqKwvvefRYCQ5Z67HFvEq"); // permanent delegate, CT authority
const FREEZE = address("JDq14BWvqCRFNu1krb12bcRpbGtJZ1FLEakMw6FdxJNs"); // freeze and pause authority
const fixtures = JSON.parse(
  fs.readFileSync(
    path.resolve(import.meta.dirname, "../fixtures/xstocks-mainnet-mints.json"),
    "utf8",
  ),
) as {
  slot: number;
  mints: { symbol: string; mint: string; dataBase64: string }[];
};
const T22 = TOKEN_2022_PROGRAM_ID;

/** Real mint bytes with the mint authority replaced; optionally CT auto-approve turned on. */
async function realMint(
  w: World,
  symbol: string,
  autoApprove = false,
): Promise<Address> {
  const record = fixtures.mints.find((m) => m.symbol === symbol)!;
  const bytes = new Uint8Array(Buffer.from(record.dataBase64, "base64"));
  const mint = address(record.mint);
  bytes.set(
    getAddressEncoder().encode(await v1.findMockMintAuthorityPda(mint)),
    4,
  );
  if (autoApprove) {
    for (let o = 166; o + 4 <= bytes.length;) {
      const type = bytes[o]! | (bytes[o + 1]! << 8);
      const len = bytes[o + 2]! | (bytes[o + 3]! << 8);
      if (type === ExtensionType.ConfidentialTransferMint)
        bytes[o + 4 + 32] = 1;
      o += 4 + len;
    }
  }
  w.env.put(mint, v1.TOKEN_2022_PROGRAM_ID, bytes);
  return mint;
}

async function allow(
  w: World,
  lists: { freeze?: Address[]; delegates?: Address[]; hooks?: Address[] },
) {
  const four = (xs: Address[] = []) =>
    [...xs, DEFAULT, DEFAULT, DEFAULT, DEFAULT].slice(0, 4);
  w.params = {
    ...w.params,
    allowedFreezeAuthorities: four(lists.freeze),
    allowedPermanentDelegates: four(lists.delegates),
    allowedTransferHookPrograms: four(lists.hooks),
  };
  await w.env.send(w.admin, [
    await v1.buildUpdateConfigInstruction(w.admin, w.params),
  ]);
}

const XSTOCK_BITS = [4, 6, 12, 14, 18, 19, 25, 26].reduce(
  (m, b) => m | (1n << BigInt(b)),
  0n,
);

describe("real xStocks (mainnet extension data)", () => {
  test("default config (empty allow-lists) rejects every xStock", async () => {
    const w = await World.create({ stocks: 0 });
    for (const { symbol } of fixtures.mints) {
      const mint = await realMint(w, symbol);
      expect(errorCode((await w.register(mint, feed(1))).logs), symbol).toBe(
        "FreezeAuthorityNotAllowed",
      );
    }
    await allow(w, { freeze: [FREEZE] });
    const mint = await realMint(w, "AAPLx");
    expect(errorCode((await w.register(mint, feed(1))).logs)).toBe(
      "PermanentDelegateNotAllowed",
    );
  });

  test("with the issuer keys allow-listed, all six fixtures register and their extensions are recorded", async () => {
    const w = await World.create({ stocks: 0 });
    await allow(w, { freeze: [FREEZE], delegates: [ISSUER] });
    for (const { symbol } of fixtures.mints) {
      const mint = await realMint(w, symbol);
      const r = await w.register(mint, feed(2));
      expect(r.ok, `${symbol}\n${r.logs.join("\n")}`).toBe(true);
      const asset = v1.decodeAssetAccount(
        w.env.data(await v1.findAssetPda(mint))!,
      );
      expect([asset.decimals, asset.scaledUiAmount, asset.extensions]).toEqual([
        8,
        true,
        XSTOCK_BITS,
      ]);
    }
  });

  test("confidential transfers with auto-approve ON are refused even with the issuer listed", async () => {
    const w = await World.create({ stocks: 0 });
    await allow(w, { freeze: [FREEZE], delegates: [ISSUER] });
    const mint = await realMint(w, "MSFTx", true);
    expect(errorCode((await w.register(mint, feed(3))).logs)).toBe(
      "ConfidentialTransferNotAllowed",
    );
  });

  test("an AAPLx leg applies the live ScaledUiAmount multiplier (1.0038023030588032)", async () => {
    const w = await World.create({ stocks: 0 });
    await allow(w, { freeze: [FREEZE], delegates: [ISSUER] });
    const mint = await realMint(w, "AAPLx");
    expect((await w.register(mint, feed(4))).ok).toBe(true);
    await w.env.send(w.owner, [ataIx(w.owner.address, mint)]);
    const stock = {
      mint,
      feedId: feed(4),
      decimals: 8,
      ownerAta: await v1.findAssociatedTokenAddress(
        w.owner.address,
        mint,
        v1.TOKEN_2022_PROGRAM_ID,
      ),
    };
    w.stocks.push(stock);
    const plan = await w.createPlan({ amount: 100_000_000n });
    const r = await w.execute(plan, 0, 1);
    expect(r.ok, r.logs.join("\n")).toBe(true);
    // The new multiplier's effective time (1,794,447,000) is before the test clock.
    const expected = v1.expectedOut({
      amountIn: 100_000_000n,
      fundingDecimals: 6,
      outputDecimals: 8,
      price: 20_000_000n,
      expo: -5,
      multiplierFp: v1.multiplierFpCeil(1.0038023030588032),
    });
    expect(w.env.tokenAmount(stock.ownerAta)).toBe(expected);
    expect(expected).toBe(49_810_604n); // vs 50,000,000 without the multiplier
  });
});

describe("synthetic mints, one rule at a time", () => {
  test("permanent delegate: refused unless allow-listed", async () => {
    const w = await World.create({ stocks: 0 });
    const delegate = (await w.env.signer()).address;
    const make = () =>
      w.mockMint(
        1,
        8,
        (m) => [
          kitIx(
            createInitializePermanentDelegateInstruction(
              pk(m),
              pk(delegate),
              T22,
            ),
          ),
        ],
        [ExtensionType.PermanentDelegate],
      );
    expect(errorCode((await w.register(await make(), feed(5))).logs)).toBe(
      "PermanentDelegateNotAllowed",
    );
    await allow(w, { delegates: [delegate] });
    expect((await w.register(await make(), feed(5))).ok).toBe(true);
  });

  test("transfer hook: no program is fine; a program must be allow-listed; a later change fails closed", async () => {
    const w = await World.create({ stocks: 0 });
    const hookProgram = (await w.env.signer()).address;
    const withHook = (program: Address | null) => (m: Address) => [
      kitIx(
        createInitializeTransferHookInstruction(
          pk(m),
          pk(w.admin.address),
          program ? pk(program) : pk(DEFAULT),
          T22,
        ),
      ),
    ];
    expect(
      errorCode(
        (
          await w.register(
            await w.mockMint(1, 8, withHook(hookProgram), [
              ExtensionType.TransferHook,
            ]),
            feed(6),
          )
        ).logs,
      ),
    ).toBe("TransferHookNotAllowed");
    const quiet = await w.mockMint(1, 8, withHook(null), [
      ExtensionType.TransferHook,
    ]);
    expect((await w.register(quiet, feed(6))).ok).toBe(true);
    // The issuer later points the hook at an unlisted program: execution refuses the leg.
    await w.env.send(w.owner, [ataIx(w.owner.address, quiet)]);
    w.stocks.push({
      mint: quiet,
      feedId: feed(6),
      decimals: 8,
      ownerAta: await v1.findAssociatedTokenAddress(
        w.owner.address,
        quiet,
        v1.TOKEN_2022_PROGRAM_ID,
      ),
    });
    const plan = await w.createPlan();
    await w.env.send(w.admin, [
      kitIx(
        createUpdateTransferHookInstruction(
          pk(quiet),
          pk(w.admin.address),
          pk(hookProgram),
          [],
          T22,
        ),
        [w.admin],
      ),
    ]);
    expect(errorCode((await w.execute(plan, 0, 1)).logs)).toBe(
      "TransferHookNotAllowed",
    );
    await allow(w, { hooks: [hookProgram] });
    expect(errorCode((await w.execute(plan, 0, 1)).logs)).not.toBe(
      "TransferHookNotAllowed",
    );
  });

  test("freeze authority on a classic SPL mint: refused unless allow-listed", async () => {
    const w = await World.create({ stocks: 0 });
    const freezer = (await w.env.signer()).address;
    const mint = (await w.env.signer()).address;
    w.env.classicMint(
      mint,
      6,
      await v1.findMockMintAuthorityPda(mint),
      freezer,
    );
    expect(
      errorCode((await w.register(mint, feed(7), v1.TOKEN_PROGRAM_ID)).logs),
    ).toBe("FreezeAuthorityNotAllowed");
    await allow(w, { freeze: [freezer] });
    expect((await w.register(mint, feed(7), v1.TOKEN_PROGRAM_ID)).ok).toBe(
      true,
    );
  });

  test("pausable: authority must be allow-listed; a paused mint is refused at execution", async () => {
    const w = await World.create({ stocks: 0 });
    const pausable = (m: Address) => [
      kitIx(
        createInitializePausableConfigInstruction(
          pk(m),
          pk(w.admin.address),
          T22,
        ),
      ),
    ];
    expect(
      errorCode(
        (
          await w.register(
            await w.mockMint(1, 8, pausable, [ExtensionType.PausableConfig]),
            feed(8),
          )
        ).logs,
      ),
    ).toBe("FreezeAuthorityNotAllowed");
    await allow(w, { freeze: [w.admin.address] });
    const mint = await w.mockMint(1, 8, pausable, [
      ExtensionType.PausableConfig,
    ]);
    expect((await w.register(mint, feed(8))).ok).toBe(true);
    await w.env.send(w.owner, [ataIx(w.owner.address, mint)]);
    w.stocks.push({
      mint,
      feedId: feed(8),
      decimals: 8,
      ownerAta: await v1.findAssociatedTokenAddress(
        w.owner.address,
        mint,
        v1.TOKEN_2022_PROGRAM_ID,
      ),
    });
    const plan = await w.createPlan();
    await w.env.send(w.admin, [
      kitIx(createPauseInstruction(pk(mint), pk(w.admin.address), [], T22), [
        w.admin,
      ]),
    ]);
    expect(errorCode((await w.execute(plan, 0, 1)).logs)).toBe("MintPaused");
  });

  const rejected: [
    string,
    ExtensionType,
    (w: World, m: Address) => ReturnType<typeof kitIx>,
    string,
  ][] = [
    [
      "non-transferable",
      ExtensionType.NonTransferable,
      (_w, m) =>
        kitIx(createInitializeNonTransferableMintInstruction(pk(m), T22)),
      "NonTransferableMint",
    ],
    [
      "interest-bearing",
      ExtensionType.InterestBearingConfig,
      (w, m) =>
        kitIx(
          createInitializeInterestBearingMintInstruction(
            pk(m),
            pk(w.admin.address),
            100,
            T22,
          ),
        ),
      "UnsupportedExtension",
    ],
    [
      "transfer fee",
      ExtensionType.TransferFeeConfig,
      (w, m) =>
        kitIx(
          createInitializeTransferFeeConfigInstruction(
            pk(m),
            pk(w.admin.address),
            pk(w.admin.address),
            10,
            1_000n,
            T22,
          ),
        ),
      "UnsupportedExtension",
    ],
    [
      "mint close authority",
      ExtensionType.MintCloseAuthority,
      (w, m) =>
        kitIx(
          createInitializeMintCloseAuthorityInstruction(
            pk(m),
            pk(w.admin.address),
            T22,
          ),
        ),
      "UnsupportedExtension",
    ],
  ];
  for (const [name, ext, init, code] of rejected) {
    test(`${name} is rejected`, async () => {
      const w = await World.create({ stocks: 0 });
      // Without ScaledUiAmount: Token-2022 refuses some combinations with it (interest-bearing).
      const mint = await w.mockMint(null, 8, (m) => [init(w, m)], [ext]);
      expect(errorCode((await w.register(mint, feed(9))).logs)).toBe(code);
    });
  }

  test("a plain classic SPL mint is accepted; a mint authority other than the mock PDA is not", async () => {
    const w = await World.create({ stocks: 0 });
    const good = (await w.env.signer()).address;
    w.env.classicMint(good, 6, await v1.findMockMintAuthorityPda(good));
    expect((await w.register(good, feed(10), v1.TOKEN_PROGRAM_ID)).ok).toBe(
      true,
    );
    const bad = (await w.env.signer()).address;
    w.env.classicMint(bad, 6, w.admin.address);
    expect(
      errorCode((await w.register(bad, feed(10), v1.TOKEN_PROGRAM_ID)).logs),
    ).toBe("MockMintAuthorityMismatch");
    expect(fixtures.slot).toBeGreaterThan(0);
  });
});
