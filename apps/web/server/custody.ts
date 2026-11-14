import {
  AROMA_GUARD_V1_PROGRAM_ID,
  BPF_LOADER_UPGRADEABLE_ID,
  DEVNET_GENESIS_HASH,
  MAINNET_GENESIS_HASH,
  decodeConfigAccount,
  findConfigPda,
} from "@aroma/guard";
import { address, getAddressDecoder, type Address } from "@solana/kit";

/**
 * Read-only custody check (P4, `pnpm check:custody`): for an Aroma Guard v1 program on a
 * cluster, the upgrade authority (BPF Upgradeable Loader ProgramData), the config admin and the
 * keeper authority, each compared with an expected value (for M10: the Squads vault). Only
 * `getGenesisHash` and `getAccountInfo` are called; nothing is signed or sent. Addresses are
 * public on-chain data, so they are printed.
 */

export type Cluster = "devnet" | "mainnet";
export type Rpc = <T>(method: string, params?: unknown[]) => Promise<T>;
type AccountInfo = { value: { owner: string; data: [string, string] } | null };

export type CustodyExpectations = {
  upgradeAuthority?: string;
  admin?: string;
  keeper?: string;
};

export type CustodyCheck = {
  name: "upgrade authority" | "config admin" | "keeper authority";
  actual: string | null;
  expected: string | null;
  status: "ok" | "mismatch" | "unchecked";
};

export type CustodyReport =
  | { state: "wrong-cluster"; detail: string }
  | { state: "not-deployed"; programId: string }
  | { state: "not-upgradeable"; programId: string; detail: string }
  | {
      state: "checked";
      programId: string;
      programData: string;
      configPda: string;
      configInitialized: boolean;
      checks: CustodyCheck[];
    };

const GENESIS: Record<Cluster, string> = {
  devnet: DEVNET_GENESIS_HASH,
  mainnet: MAINNET_GENESIS_HASH,
};
const addressDecoder = getAddressDecoder();
const bytes = (info: AccountInfo["value"]) =>
  info ? Buffer.from(info.data[0], "base64") : Buffer.alloc(0);

const getAccount = (rpc: Rpc, key: string) =>
  rpc<AccountInfo>("getAccountInfo", [
    key,
    { encoding: "base64", commitment: "confirmed" },
  ]);

function compare(
  name: CustodyCheck["name"],
  actual: string | null,
  expected: string | undefined,
): CustodyCheck {
  if (!expected) return { name, actual, expected: null, status: "unchecked" };
  return {
    name,
    actual,
    expected,
    status: actual === expected ? "ok" : "mismatch",
  };
}

export async function checkCustody(
  rpc: Rpc,
  input: { cluster: Cluster; programId?: string; expect: CustodyExpectations },
): Promise<CustodyReport> {
  const genesis = await rpc<string>("getGenesisHash");
  if (genesis !== GENESIS[input.cluster])
    return {
      state: "wrong-cluster",
      detail: `the RPC is not ${input.cluster}`,
    };
  const programId: Address = input.programId
    ? address(input.programId)
    : AROMA_GUARD_V1_PROGRAM_ID;

  const program = (await getAccount(rpc, programId)).value;
  if (!program) return { state: "not-deployed", programId };
  const programBytes = bytes(program);
  if (
    program.owner !== BPF_LOADER_UPGRADEABLE_ID ||
    programBytes.length < 36 ||
    programBytes.readUInt32LE(0) !== 2
  )
    return {
      state: "not-upgradeable",
      programId,
      detail: "not a BPF Upgradeable Loader program account",
    };
  const programData = addressDecoder.decode(programBytes.subarray(4, 36));

  const data = bytes((await getAccount(rpc, programData)).value);
  if (data.length < 13 || data.readUInt32LE(0) !== 3)
    return {
      state: "not-upgradeable",
      programId,
      detail: "ProgramData account missing or malformed",
    };
  // ProgramData: u32 tag (3), u64 slot, Option<Pubkey> (1 byte tag + 32 bytes).
  const upgradeAuthority =
    data[12] === 1 ? addressDecoder.decode(data.subarray(13, 45)) : null;

  const configPda = await findConfigPda(programId);
  const configInfo = (await getAccount(rpc, configPda)).value;
  let admin: string | null = null;
  let keeper: string | null = null;
  if (configInfo && configInfo.owner === programId) {
    const config = decodeConfigAccount(bytes(configInfo));
    admin = config.admin;
    keeper =
      config.keeperAuthority.__option === "Some"
        ? config.keeperAuthority.value
        : null;
  }
  return {
    state: "checked",
    programId,
    programData,
    configPda,
    configInitialized: Boolean(configInfo),
    checks: [
      compare(
        "upgrade authority",
        upgradeAuthority,
        input.expect.upgradeAuthority,
      ),
      compare("config admin", admin, input.expect.admin),
      compare("keeper authority", keeper, input.expect.keeper),
    ],
  };
}

export function custodyFailed(
  report: CustodyReport,
  requireDeployed: boolean,
): boolean {
  if (report.state === "wrong-cluster" || report.state === "not-upgradeable")
    return true;
  if (report.state === "not-deployed") return requireDeployed;
  return report.checks.some((c) => c.status === "mismatch");
}

export function formatCustody(report: CustodyReport): string {
  switch (report.state) {
    case "wrong-cluster":
      return `WRONG CLUSTER: ${report.detail}`;
    case "not-deployed":
      return `NOT DEPLOYED: no program account at ${report.programId} on this cluster`;
    case "not-upgradeable":
      return `INVALID: ${report.programId}: ${report.detail}`;
    case "checked":
      return [
        `program      ${report.programId}`,
        `program data ${report.programData}`,
        `config PDA   ${report.configPda}${report.configInitialized ? "" : " (not initialized)"}`,
        ...report.checks.map(
          (c) =>
            `${c.status.toUpperCase().padEnd(9)} ${c.name}: ${c.actual ?? "none (immutable or unset)"}${c.expected ? ` (expected ${c.expected})` : ""}`,
        ),
      ].join("\n");
  }
}
