import {
  AROMA_GUARD_V1_PROGRAM_ID,
  BPF_LOADER_UPGRADEABLE_ID,
  DEVNET_GENESIS_HASH,
  MAINNET_GENESIS_HASH,
  findConfigPda,
} from "@aroma/guard";
import { CONFIG_DISCRIMINATOR, getConfigEncoder } from "@aroma/guard/generated";
import { address, getAddressEncoder, none, some } from "@solana/kit";
import { describe, expect, it, vi } from "vitest";
import {
  checkCustody,
  custodyFailed,
  formatCustody,
  type Rpc,
} from "./custody";

/** P4: the read-only custody check against synthetic loader and config accounts. */
const SQUADS = "SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu";
const DEPLOYER = "4Nd1mYQzvgp7uVDYiHn9wrpTkMtZpZyV9pR9ZJ2q5vPz";
const KEEPER = "Vote111111111111111111111111111111111111111";
const PROGRAM_DATA = "BPFLoader2111111111111111111111111111111111";
const enc = getAddressEncoder();
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

function programAccount() {
  const data = Buffer.alloc(36);
  data.writeUInt32LE(2, 0);
  Buffer.from(enc.encode(address(PROGRAM_DATA))).copy(data, 4);
  return { owner: BPF_LOADER_UPGRADEABLE_ID, data: [b64(data), "base64"] };
}
function programDataAccount(authority: string | null) {
  const data = Buffer.alloc(45 + 16);
  data.writeUInt32LE(3, 0);
  data.writeBigUInt64LE(123n, 4);
  data[12] = authority ? 1 : 0;
  if (authority) Buffer.from(enc.encode(address(authority))).copy(data, 13);
  return { owner: BPF_LOADER_UPGRADEABLE_ID, data: [b64(data), "base64"] };
}
function configAccount(admin: string, keeper: string | null) {
  const zero = address("11111111111111111111111111111111");
  const bytes = getConfigEncoder().encode({
    version: 1,
    admin: address(admin),
    keeperAuthority: keeper ? some(address(keeper)) : none(),
    paused: false,
    allowedFundingMints: [zero, zero, zero, zero],
    maxSlippageBps: 100,
    maxOracleStalenessS: 60,
    catchUpWindowPeriods: 1,
    protocolFeeBps: 0,
    feeRecipient: zero,
    maxInstallmentAmount: 1n,
    bump: 255,
    maxConfidenceBps: 100,
    treasury: zero,
    allowedFreezeAuthorities: Array(4).fill(zero),
    allowedPermanentDelegates: Array(4).fill(zero),
    allowedTransferHookPrograms: Array(4).fill(zero),
    reserved: new Uint8Array(64),
  } as unknown as Parameters<ReturnType<typeof getConfigEncoder>["encode"]>[0]);
  expect(Buffer.from(bytes.subarray(0, 8))).toEqual(
    Buffer.from(CONFIG_DISCRIMINATOR),
  );
  return {
    owner: AROMA_GUARD_V1_PROGRAM_ID,
    data: [b64(Uint8Array.from(bytes)), "base64"],
  };
}

async function fakeRpc(
  accounts: Record<string, unknown>,
  genesis = MAINNET_GENESIS_HASH,
) {
  const methods: string[] = [];
  const rpc = vi.fn(async (method: string, params: unknown[] = []) => {
    methods.push(method);
    if (method === "getGenesisHash") return genesis;
    if (method === "getAccountInfo")
      return { value: accounts[params[0] as string] ?? null };
    throw new Error(`unexpected ${method}`);
  }) as unknown as Rpc;
  return { rpc, methods };
}

describe("checkCustody (read-only)", () => {
  it("multisig verified: upgrade authority, admin and keeper match; only reads", async () => {
    const config = await findConfigPda();
    const { rpc, methods } = await fakeRpc({
      [AROMA_GUARD_V1_PROGRAM_ID]: programAccount(),
      [PROGRAM_DATA]: programDataAccount(SQUADS),
      [config]: configAccount(SQUADS, KEEPER),
    });
    const report = await checkCustody(rpc, {
      cluster: "mainnet",
      expect: { upgradeAuthority: SQUADS, admin: SQUADS, keeper: KEEPER },
    });
    expect(report).toMatchObject({
      state: "checked",
      programData: PROGRAM_DATA,
      configPda: config,
    });
    if (report.state === "checked")
      expect(report.checks.map((c) => c.status)).toEqual(["ok", "ok", "ok"]);
    expect(custodyFailed(report, true)).toBe(false);
    expect(new Set(methods)).toEqual(
      new Set(["getGenesisHash", "getAccountInfo"]),
    );
  });

  it("a deployer (not the multisig) as upgrade authority is a mismatch", async () => {
    const { rpc } = await fakeRpc({
      [AROMA_GUARD_V1_PROGRAM_ID]: programAccount(),
      [PROGRAM_DATA]: programDataAccount(DEPLOYER),
    });
    const report = await checkCustody(rpc, {
      cluster: "mainnet",
      expect: { upgradeAuthority: SQUADS },
    });
    expect(custodyFailed(report, true)).toBe(true);
    expect(formatCustody(report)).toMatch(/MISMATCH\s+upgrade authority: 4Nd1/);
    expect(formatCustody(report)).toMatch(/not initialized/);
  });

  it("an immutable program (no authority) is reported as none", async () => {
    const { rpc } = await fakeRpc({
      [AROMA_GUARD_V1_PROGRAM_ID]: programAccount(),
      [PROGRAM_DATA]: programDataAccount(null),
    });
    const report = await checkCustody(rpc, { cluster: "mainnet", expect: {} });
    expect(formatCustody(report)).toMatch(/UNCHECKED upgrade authority: none/);
  });

  it("not deployed is clean (fails only with --require-deployed)", async () => {
    const { rpc } = await fakeRpc({}, DEVNET_GENESIS_HASH);
    const report = await checkCustody(rpc, { cluster: "devnet", expect: {} });
    expect(report.state).toBe("not-deployed");
    expect(custodyFailed(report, false)).toBe(false);
    expect(custodyFailed(report, true)).toBe(true);
  });

  it("the wrong cluster is refused before any account read", async () => {
    const { rpc, methods } = await fakeRpc({}, DEVNET_GENESIS_HASH);
    const report = await checkCustody(rpc, { cluster: "mainnet", expect: {} });
    expect(report.state).toBe("wrong-cluster");
    expect(methods).toEqual(["getGenesisHash"]);
  });

  it("an account not owned by the upgradeable loader is invalid", async () => {
    const { rpc } = await fakeRpc({
      [AROMA_GUARD_V1_PROGRAM_ID]: {
        ...programAccount(),
        owner: "11111111111111111111111111111111",
      },
    });
    const report = await checkCustody(rpc, { cluster: "mainnet", expect: {} });
    expect(report.state).toBe("not-upgradeable");
  });
});
