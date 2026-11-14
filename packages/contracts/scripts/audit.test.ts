import { describe, expect, test } from "vitest";
import {
  generateKeyPairSigner,
  getAddressEncoder,
  getBase58Decoder,
  type Address,
  type ReadonlyUint8Array,
} from "@solana/kit";
import * as v1 from "@aroma/guard";
import { getAssetEncoder, getConfigEncoder } from "@aroma/guard/generated";
import { auditDevnet } from "./lib/audit";
import { GENESIS } from "./lib/cluster";
import type { JsonRpc } from "./lib/jsonrpc";

const NONE = "11111111111111111111111111111111" as Address;
const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const T22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const enc = getAddressEncoder();
const b64 = (d: Uint8Array | ReadonlyUint8Array) => [
  Buffer.from(d).toString("base64"),
  "base64",
];

function mint(
  authority: Address | null,
  decimals: number,
  freeze: Address | null = null,
) {
  const d = new Uint8Array(82);
  if (authority) {
    d[0] = 1;
    d.set(enc.encode(authority), 4);
  }
  d[44] = decimals;
  d[45] = 1;
  if (freeze) {
    d[46] = 1;
    d.set(enc.encode(freeze), 50);
  }
  return d;
}

async function world(
  o: {
    genesis?: string;
    upgradeAuthority?: Address;
    stockAuthority?: "pda" | "other";
    extraFunding?: boolean;
    /** Who holds the test USD mint authority (default: the faucet key, M7). */
    usdAuthority?: "faucet" | "deployer";
  } = {},
) {
  const key = async () => (await generateKeyPairSigner()).address;
  const deployer = await key();
  const keeper = await key();
  const faucet = await key();
  const usd = await key();
  const stock = await key();
  const programData = await v1.findProgramDataAddress();
  const pd = new Uint8Array(45);
  pd[0] = 3;
  pd[12] = 1;
  pd.set(enc.encode(o.upgradeAuthority ?? deployer), 13);
  const prog = new Uint8Array(36);
  prog[0] = 2;
  prog.set(enc.encode(programData), 4);
  const four = [usd, o.extraFunding ? keeper : NONE, NONE, NONE];
  const config = getConfigEncoder().encode({
    version: 1,
    admin: deployer,
    keeperAuthority: keeper,
    paused: false,
    allowedFundingMints: four,
    maxSlippageBps: 300,
    maxOracleStalenessS: 60,
    catchUpWindowPeriods: 1,
    protocolFeeBps: 0,
    feeRecipient: NONE,
    maxInstallmentAmount: 500_000_000n,
    bump: 255,
    maxConfidenceBps: 200,
    treasury: deployer,
    allowedFreezeAuthorities: [NONE, NONE, NONE, NONE],
    allowedPermanentDelegates: [NONE, NONE, NONE, NONE],
    allowedTransferHookPrograms: [NONE, NONE, NONE, NONE],
    reserved: new Uint8Array(128),
  });
  const asset = getAssetEncoder().encode({
    version: 1,
    mint: stock,
    tokenProgram: T22 as Address,
    pythFeedId: new Uint8Array(32).fill(1),
    decimals: 8,
    enabled: true,
    bump: 1,
    extensions: 0n,
    scaledUiAmount: true,
    mockMintBump: 1,
    registeredAt: 0n,
    reserved: new Uint8Array(64),
  });
  const pda = await v1.findMockMintAuthorityPda(stock);
  const accounts: Record<
    string,
    { owner: string; executable: boolean; data: string[] }
  > = {
    [v1.AROMA_GUARD_V1_PROGRAM_ID]: {
      owner: LOADER,
      executable: true,
      data: b64(prog),
    },
    [programData]: { owner: LOADER, executable: false, data: b64(pd) },
    [await v1.findConfigPda()]: {
      owner: v1.AROMA_GUARD_V1_PROGRAM_ID,
      executable: false,
      data: b64(config),
    },
    [usd]: {
      owner: v1.TOKEN_PROGRAM_ID,
      executable: false,
      data: b64(mint(o.usdAuthority === "deployer" ? deployer : faucet, 6)),
    },
    [stock]: {
      owner: T22,
      executable: false,
      data: b64(mint(o.stockAuthority === "other" ? deployer : pda, 8)),
    },
  };
  const calls: string[] = [];
  const rpc: JsonRpc = async <T>(method: string, params: unknown[] = []) => {
    calls.push(method);
    if (method === "getGenesisHash") return (o.genesis ?? GENESIS.devnet) as T;
    if (method === "getAccountInfo")
      return { value: accounts[params[0] as string] ?? null } as T;
    if (method === "getProgramAccounts") {
      const filter = (params[1] as { filters: { memcmp: { bytes: string } }[] })
        .filters[0]!.memcmp.bytes;
      expect(filter).toBe(
        getBase58Decoder().decode(v1.getAssetDiscriminatorBytes()),
      );
      return [
        {
          pubkey: await v1.findAssetPda(stock),
          account: {
            owner: v1.AROMA_GUARD_V1_PROGRAM_ID,
            executable: false,
            data: b64(asset),
          },
        },
      ] as T;
    }
    throw new Error(`unexpected ${method}`);
  };
  return {
    rpc,
    calls,
    expect: {
      programId: v1.AROMA_GUARD_V1_PROGRAM_ID,
      deployer,
      keeper,
      faucet,
      testUsd: usd,
    },
  };
}

describe("read-only devnet audit", () => {
  test("stops at the genesis check on another network", async () => {
    const w = await world({ genesis: GENESIS.mainnet });
    await expect(auditDevnet(w.rpc, w.expect)).rejects.toThrow(/non-devnet/);
    expect(w.calls).toEqual(["getGenesisHash"]);
  });

  test("a test USD minted by the deployer is flagged (M7: the faucet key holds it)", async () => {
    const w = await world({ usdAuthority: "deployer" });
    const r = await auditDevnet(w.rpc, w.expect);
    expect(r.passed).toBe(false);
    expect(r.checks.testUsdAuthorityIsFaucet).toBe(false);
    expect(r.issues.join(" ")).toMatch(/still the deployer/);
    const same = await auditDevnet(w.rpc, {
      ...w.expect,
      faucet: w.expect.deployer,
    });
    expect(same.checks.testUsdAuthorityIsFaucet).toBe(false);
  });

  test("a correct deployment passes: stocks need their PDA, the test USD belongs to the faucet key", async () => {
    const w = await world();
    const r = await auditDevnet(w.rpc, w.expect);
    expect(r.issues).toEqual([]);
    expect(r.passed).toBe(true);
    expect(r.transactionsSubmitted).toBe(0);
    expect(new Set(w.calls)).toEqual(
      new Set(["getGenesisHash", "getAccountInfo", "getProgramAccounts"]),
    );
  });

  test("a wrong upgrade authority, a foreign funding mint and a wrong stock authority are flagged", async () => {
    const stranger = (await generateKeyPairSigner()).address;
    const r = await auditDevnet(
      ...(await (async () => {
        const w = await world({
          upgradeAuthority: stranger,
          extraFunding: true,
          stockAuthority: "other",
        });
        return [w.rpc, w.expect] as const;
      })()),
    );
    expect(r.passed).toBe(false);
    expect(r.checks).toMatchObject({
      upgradeAuthorityIsDeployer: false,
      noForeignFundingMint: false,
      everyAssetMintAuthorityIsItsPda: false,
    });
    expect(r.issues.join(" ")).toMatch(/upgrade authority/);
  });

  test("never calls a state-changing method", async () => {
    const w = await world();
    const sneaky: JsonRpc = (method, params) =>
      method === "getAccountInfo"
        ? w.rpc(method, params)
        : w.rpc(method, params);
    await auditDevnet(sneaky, w.expect);
    const { readOnly } = await import("./lib/jsonrpc");
    expect(() => readOnly(w.rpc)("sendTransaction", [])).toThrow(/only reads/);
    expect(() => readOnly(w.rpc)("requestAirdrop", [])).toThrow(/only reads/);
  });
});
