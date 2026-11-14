import { describe, expect, test } from "vitest";
import {
  createKeyPairSignerFromBytes,
  generateKeyPairSigner,
  type Address,
  type KeyPairSigner,
  getAddressEncoder,
} from "@solana/kit";
import { parseArgs } from "./lib/args";
import { assertDevnet, assertLocalnet, GENESIS } from "./lib/cluster";
import { newExportableKeypair } from "./lib/keys";
import {
  ensureMint,
  parseMintFacts,
  supplyShortfall,
  validateExistingMint,
  type MintSpec,
  type ProvisionDeps,
  type ProvisionState,
} from "./lib/provision";

const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;
const genesis = (value: string | Error) => ({
  getGenesisHash: () => ({
    send: async () => {
      if (value instanceof Error) throw value;
      return value;
    },
  }),
});

describe("cluster guards", () => {
  test("devnet scripts refuse mainnet, testnet and an unreachable RPC before any other call", async () => {
    await expect(
      assertDevnet(genesis(GENESIS.devnet)),
    ).resolves.toBeUndefined();
    await expect(assertDevnet(genesis(GENESIS.mainnet))).rejects.toThrow(
      /not Solana devnet/,
    );
    await expect(assertDevnet(genesis(GENESIS.testnet))).rejects.toThrow(
      /not Solana devnet/,
    );
    await expect(assertDevnet(genesis(new Error("offline")))).rejects.toThrow(
      /RPC offline/,
    );
  });

  test("the local run refuses remote hosts and public genesis hashes", async () => {
    await expect(
      assertLocalnet(genesis("local-genesis"), "http://127.0.0.1:8899"),
    ).resolves.toBeUndefined();
    await expect(
      assertLocalnet(genesis("local-genesis"), "https://api.devnet.solana.com"),
    ).rejects.toThrow(/localnet only/);
    await expect(
      assertLocalnet(genesis(GENESIS.devnet), "http://localhost:8899"),
    ).rejects.toThrow(/public cluster/);
  });
});

function mintBytes(o: {
  authority: Address | null;
  freeze?: Address | null;
  decimals: number;
  initialized?: boolean;
  scaled?: boolean;
}): Uint8Array {
  const data = new Uint8Array(o.scaled ? 166 + 4 + 56 : 82);
  const key = (at: number, k: Address | null) => {
    if (!k) return;
    data[at] = 1;
    data.set(getAddressEncoder().encode(k), at + 4);
  };
  key(0, o.authority);
  data[44] = o.decimals;
  data[45] = o.initialized === false ? 0 : 1;
  key(46, o.freeze ?? null);
  if (o.scaled) {
    data[165] = 1;
    data[166] = 25;
    data[168] = 56;
  }
  return data;
}

describe("mint reuse", () => {
  test("an existing mint is reused only if it matches exactly", async () => {
    const authority = (await generateKeyPairSigner()).address;
    const spec: MintSpec = {
      label: "tUSD",
      tokenProgram: TOKEN,
      decimals: 6,
      mintAuthority: authority,
      scaled: false,
    };
    validateExistingMint(
      parseMintFacts(TOKEN, mintBytes({ authority, decimals: 6 })),
      spec,
    );
    const other = (await generateKeyPairSigner()).address;
    for (const bad of [
      parseMintFacts(TOKEN, mintBytes({ authority, decimals: 9 })),
      parseMintFacts(TOKEN, mintBytes({ authority: other, decimals: 6 })),
      parseMintFacts(TOKEN, mintBytes({ authority: null, decimals: 6 })),
      parseMintFacts(
        TOKEN,
        mintBytes({ authority, freeze: authority, decimals: 6 }),
      ),
      parseMintFacts(
        TOKEN,
        mintBytes({ authority, decimals: 6, initialized: false }),
      ),
      parseMintFacts(other, mintBytes({ authority, decimals: 6 })),
      parseMintFacts(
        TOKEN,
        mintBytes({ authority, decimals: 6, scaled: true }),
      ),
    ])
      expect(() => validateExistingMint(bad, spec)).toThrow(
        /will not be replaced/,
      );
    expect(() => parseMintFacts(TOKEN, new Uint8Array(10))).toThrow(
      /Not a mint/,
    );
  });

  test("supply top-ups use exact bigint arithmetic", () => {
    expect(supplyShortfall(0n, 1_000_000_000_000n)).toBe(1_000_000_000_000n);
    expect(supplyShortfall(999_999_999_999n, 1_000_000_000_000n)).toBe(1n);
    expect(supplyShortfall(2_000_000_000_000n, 1_000_000_000_000n)).toBe(0n);
    expect(supplyShortfall(0n, 10n ** 24n)).toBe(10n ** 24n);
  });
});

/** In-memory chain + state for ensureMint. */
async function harness() {
  const accounts = new Map<string, Uint8Array>();
  const events: string[] = [];
  const authority = (await generateKeyPairSigner()).address;
  const state: ProvisionState = {
    network: "devnet",
    genesisHash: GENESIS.devnet,
    programId: authority,
    assets: {},
  };
  const secrets = new Map<string, number[]>();
  let failNextSend = false;
  const deps: ProvisionDeps = {
    readAccount: async (a) =>
      accounts.has(a) ? { owner: TOKEN, data: accounts.get(a)! } : null,
    send: async () => {
      events.push("create");
      if (failNextSend) {
        failNextSend = false;
        throw new Error("confirmation timeout");
      }
      return "sig";
    },
    generateMint: async () => {
      const { signer, secret } = await newExportableKeypair();
      secrets.set(signer.address, secret);
      return signer;
    },
    restoreMint: (secret) =>
      createKeyPairSignerFromBytes(Uint8Array.from(secret)),
    exportSecret: async (m) => secrets.get(m.address)!,
    save: async () => void events.push(`save:${state.testUsd?.status}`),
  };
  const spec = {
    label: "tUSD",
    tokenProgram: TOKEN,
    decimals: 6,
    mintAuthority: authority,
    scaled: false,
  };
  const build = async (mint: KeyPairSigner) => {
    accounts.set(mint.address, mintBytes({ authority, decimals: 6 }));
    return [];
  };
  const payer = await generateKeyPairSigner();
  const run = () =>
    ensureMint(
      deps,
      state,
      (r) => (state.testUsd = r),
      state.testUsd,
      spec,
      payer,
      build,
    );
  return { run, state, events, accounts, fail: () => (failNextSend = true) };
}

describe("idempotent provisioning", () => {
  test("a completed provision is reused and never creates a second mint", async () => {
    const h = await harness();
    const first = await h.run();
    const second = await h.run();
    expect(second.mint).toBe(first.mint);
    expect(h.events).toEqual(["save:pending", "create", "save:created"]);
    expect(h.state.testUsd).toEqual({ mint: first.mint, status: "created" }); // no secret kept
  });

  test("a creation timeout resumes from the checkpoint with the same keypair", async () => {
    const h = await harness();
    h.fail();
    await expect(h.run()).rejects.toThrow(/timeout/);
    expect(h.state.testUsd?.status).toBe("pending");
    const pending = h.state.testUsd!.mint;
    const recovered = await h.run(); // the account landed despite the timeout
    expect(recovered.mint).toBe(pending);
    expect(h.events.filter((e) => e === "create")).toHaveLength(1);
  });

  test("a checkpoint that disagrees with its keypair, or a recorded mint missing on chain, fails without creating", async () => {
    const h = await harness();
    const other = await newExportableKeypair();
    h.state.testUsd = {
      mint: (await generateKeyPairSigner()).address,
      status: "pending",
      secretKey: other.secret,
    };
    await expect(h.run()).rejects.toThrow(/disagree/);
    h.state.testUsd = { mint: other.signer.address, status: "created" };
    await expect(h.run()).rejects.toThrow(/missing on chain/);
    expect(h.events).not.toContain("create");
  });
});

test("arguments: flags, values, missing values and unknown arguments", () => {
  const a = parseArgs(["--list", "--symbols", "aapl,MSFT"], {
    flags: ["--list", "--dry-run"],
    values: ["--symbols"],
  });
  expect([...a.flags]).toEqual(["--list"]);
  expect(a.values.get("--symbols")).toBe("aapl,MSFT");
  expect(() => parseArgs(["--symbols"], { values: ["--symbols"] })).toThrow(
    /requires/,
  );
  expect(() => parseArgs(["--mystery"], {})).toThrow(/Unknown/);
});
