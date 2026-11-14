import { expect, test } from "vitest";
import { PublicKey } from "@solana/web3.js";
import {
  ACCOUNT_SIZE,
  AccountType,
  ExtensionType,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  getJupiterIntermediateMints,
  validateJupiterIntermediateMint,
} from "./route-plan";

const mint = (value: number) =>
  new PublicKey(new Uint8Array(32).fill(value)).toBase58();
const input = mint(1),
  output = mint(2),
  bridge = mint(3),
  alternate = mint(4),
  unrelated = mint(5);
const hop = (inputMint: unknown, outputMint: unknown) => ({
  swapInfo: { inputMint, outputMint },
});

test("direct routes have no intermediate mints", () => {
  expect(
    getJupiterIntermediateMints([hop(input, output)], input, output),
  ).toEqual(new Set());
});

test("multi-hop routes return only the connected intermediate mints", () => {
  expect(
    getJupiterIntermediateMints(
      [hop(input, bridge), hop(bridge, alternate), hop(alternate, output)],
      input,
      output,
    ),
  ).toEqual(new Set([bridge, alternate]));
});

test("split routes may merge and list their steps out of order", () => {
  expect(
    getJupiterIntermediateMints(
      [
        hop(bridge, output),
        hop(input, alternate),
        hop(input, bridge),
        hop(alternate, bridge),
        hop(input, output),
      ],
      input,
      output,
    ),
  ).toEqual(new Set([alternate, bridge]));
});

test("missing and oversized route plans fail closed", () => {
  for (const plan of [
    undefined,
    null,
    [],
    {},
    "route",
    Array(65).fill(hop(input, output)),
  ])
    expect(() => getJupiterIntermediateMints(plan, input, output)).toThrow(
      /route plan/,
    );
  const path = Array.from({ length: 65 }, (_, index) => mint(index + 1));
  const longestPlan = path
    .slice(1)
    .map((destination, index) => hop(path[index]!, destination));
  expect(getJupiterIntermediateMints(longestPlan, path[0]!, path[64]!).size).toBe(
    63,
  );
});

test("malformed steps and noncanonical public keys are rejected", () => {
  for (const step of [
    null,
    [],
    {},
    { swapInfo: null },
    { swapInfo: [] },
    hop(undefined, output),
    hop(input, 123),
    hop("not-a-public-key", output),
    hop(input, ` ${output}`),
    hop(`${input} `, output),
    hop("1".repeat(33), output),
  ])
    expect(() => getJupiterIntermediateMints([step], input, output)).toThrow(
      /route plan/,
    );
});

test("same-mint hops and invalid endpoints are rejected", () => {
  expect(() =>
    getJupiterIntermediateMints([hop(input, input)], input, output),
  ).toThrow(/same-mint/);
  for (const endpoints of [
    ["invalid", output],
    [input, "invalid"],
    [input, input],
  ])
    expect(() =>
      getJupiterIntermediateMints(
        [hop(input, output)],
        endpoints[0]!,
        endpoints[1]!,
      ),
    ).toThrow(/route plan/);
});

test("disconnected metadata cannot authorize an unrelated intermediate mint", () => {
  for (const plan of [
    [hop(input, output), hop(bridge, unrelated)],
    [hop(input, output), hop(bridge, unrelated), hop(unrelated, bridge)],
    [hop(input, bridge), hop(alternate, output)],
  ])
    expect(() => getJupiterIntermediateMints(plan, input, output)).toThrow(
      /unrelated swap path/,
    );
});

test("each branch must both originate at input and reach output", () => {
  for (const extra of [hop(input, unrelated), hop(unrelated, output)])
    expect(() =>
      getJupiterIntermediateMints([hop(input, output), extra], input, output),
    ).toThrow(/unrelated swap path/);
});

function mintAccount({
  owner = TOKEN_PROGRAM_ID.toBase58(),
  initialized = true,
  decimals = 6,
  extensions = [],
}: {
  owner?: string;
  initialized?: boolean;
  decimals?: number;
  extensions?: Array<{ type: number; data: Buffer }>;
} = {}) {
  const data = Buffer.alloc(
    extensions.length
      ? ACCOUNT_SIZE +
          1 +
          extensions.reduce(
            (size, extension) => size + 4 + extension.data.length,
            0,
          )
      : MINT_SIZE,
  );
  data[44] = decimals;
  data[45] = Number(initialized);
  if (extensions.length) data[ACCOUNT_SIZE] = AccountType.Mint;
  let offset = ACCOUNT_SIZE + 1;
  for (const extension of extensions) {
    data.writeUInt16LE(extension.type, offset);
    data.writeUInt16LE(extension.data.length, offset + 2);
    extension.data.copy(data, offset + 4);
    offset += 4 + extension.data.length;
  }
  return { owner, data, executable: false };
}

test("initialized plain legacy and Token-2022 mints return their verified program", () => {
  for (const owner of [
    TOKEN_PROGRAM_ID.toBase58(),
    TOKEN_2022_PROGRAM_ID.toBase58(),
  ])
    for (const decimals of [0, 6, 18])
      expect(
        validateJupiterIntermediateMint(
          bridge,
          mintAccount({ owner, decimals }),
        ),
      ).toBe(owner);
});

test("Token-2022 intermediate mints may contain inert metadata extensions", () => {
  const owner = TOKEN_2022_PROGRAM_ID.toBase58();
  const metadata = Buffer.alloc(80);
  new PublicKey(bridge).toBuffer().copy(metadata, 32);
  const pointer = Buffer.alloc(64);
  new PublicKey(bridge).toBuffer().copy(pointer, 32);
  const extensions = [
    { type: ExtensionType.MetadataPointer, data: pointer },
    { type: ExtensionType.TokenMetadata, data: metadata },
  ];
  for (const allowed of [extensions, [extensions[0]!], [extensions[1]!]])
    expect(
      validateJupiterIntermediateMint(
        bridge,
        mintAccount({ owner, extensions: allowed }),
      ),
    ).toBe(owner);
});

test("missing, truncated, uninitialized and wrong-owner intermediate mints fail closed", () => {
  for (const account of [
    null,
    { ...mintAccount(), data: Buffer.alloc(81) },
    mintAccount({ initialized: false }),
    mintAccount({ decimals: 19 }),
    mintAccount({ owner: input }),
    { ...mintAccount(), executable: true },
  ])
    expect(() => validateJupiterIntermediateMint(bridge, account)).toThrow(
      /invalid or unsupported intermediate token mint/,
    );
});

test("transfer-affecting, unknown and malformed intermediate mint extensions are rejected", () => {
  const owner = TOKEN_2022_PROGRAM_ID.toBase58();
  for (const type of [
    ExtensionType.TransferFeeConfig,
    ExtensionType.TransferHook,
    ExtensionType.PermanentDelegate,
    ExtensionType.NonTransferable,
    ExtensionType.DefaultAccountState,
    ExtensionType.ConfidentialTransferMint,
    65535,
  ])
    expect(() =>
      validateJupiterIntermediateMint(
        bridge,
        mintAccount({
          owner,
          extensions: [{ type, data: Buffer.alloc(64) }],
        }),
      ),
    ).toThrow(/invalid or unsupported intermediate token mint/);

  const pointer = {
    type: ExtensionType.MetadataPointer,
    data: Buffer.alloc(64),
  };
  const valid = mintAccount({ owner, extensions: [pointer] });
  const oversized = { ...valid, data: Buffer.from(valid.data) };
  oversized.data.writeUInt16LE(65, ACCOUNT_SIZE + 3);
  for (const account of [
    mintAccount({ extensions: [pointer] }),
    mintAccount({ owner, extensions: [pointer, pointer] }),
    mintAccount({
      owner,
      extensions: [
        { type: ExtensionType.TokenMetadata, data: Buffer.alloc(79) },
      ],
    }),
    { ...valid, data: valid.data.subarray(0, valid.data.length - 1) },
    { ...valid, data: Buffer.concat([valid.data, Buffer.from([1])]) },
    oversized,
  ])
    expect(() => validateJupiterIntermediateMint(bridge, account)).toThrow(
      /invalid or unsupported intermediate token mint/,
    );
});
