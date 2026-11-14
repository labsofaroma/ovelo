import "server-only";
import { describeSimulationFailure } from "@/lib/sdk/core/errors";
import { testSwitchesAllowed } from "@/server/env.schema";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import {
  assertMainnetRpcUrl,
  DEFAULT_MAINNET_RPC,
  GENESIS_HASHES,
} from "@/server/rpc";
import {
  createRpcPool,
  type MainnetRpc,
  type RpcEndpoint,
  type RpcPool,
} from "./rpc-pool";

/**
 * Mainnet JSON-RPC for the trade path (ported from composed-transactions.ts). The endpoints and
 * the genesis hash they must report come from server/rpc.ts (AGENTS.md rule 3). Every endpoint
 * proves that genesis before it serves a call, and every operation that can lead to a broadcast
 * also calls `assertMainnet`. Failover between SOLANA_RPC_URL and SOLANA_RPC_FALLBACK_URL follows
 * the rules in rpc-pool.ts (M9).
 *
 * E2E only: with test switches allowed (never on a Vercel production deployment) and a LOOPBACK
 * SOLANA_RPC_URL, AROMA_V1_TEST_FORK_GENESIS names the genesis of a local mainnet fork
 * (solana-test-validator with cloned mainnet accounts). Any other endpoint keeps mainnet rules.
 */

export type RpcAccount = {
  data: [string, string];
  owner: string;
  executable: boolean;
  lamports: number;
} | null;

export type { MainnetRpc } from "./rpc-pool";
export { RpcError } from "./rpc-pool";

const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/;
let forkWarned = false;

/** The primary endpoint (SOLANA_RPC_URL), or the declared local fork in E2E. */
export function mainnetEndpoint(): {
  url: string;
  genesis: string;
  fork: boolean;
} {
  const raw = process.env.SOLANA_RPC_URL?.trim() || DEFAULT_MAINNET_RPC;
  const forkGenesis = forkGenesisFor(raw);
  if (forkGenesis) {
    if (!forkWarned) {
      forkWarned = true;
      logger.warn(
        "trade RPC points at a LOCAL FORK (AROMA_V1_TEST_FORK_GENESIS); test switch",
      );
    }
    return { url: new URL(raw).toString(), genesis: forkGenesis, fork: true };
  }
  return {
    url: assertMainnetRpcUrl(raw),
    genesis: GENESIS_HASHES["mainnet-beta"],
    fork: false,
  };
}

/** The fork genesis when `raw` is loopback AND the E2E fork switch is on; otherwise null. */
function forkGenesisFor(raw: string): string | null {
  const forkGenesis = process.env.AROMA_V1_TEST_FORK_GENESIS?.trim();
  return forkGenesis && LOOPBACK.test(raw) && testSwitchesAllowed(process.env)
    ? forkGenesis
    : null;
}

/**
 * Primary, then the optional SOLANA_RPC_FALLBACK_URL (M9 failover). The fallback is validated
 * like the primary (HTTPS, no credentials, not devnet-looking; loopback only for the declared
 * E2E fork, and only next to a fork primary), must differ from it, and must prove the same
 * genesis on its own (rpc-pool.ts). An invalid fallback fails closed; boot refuses it too.
 */
export function mainnetEndpoints(): RpcEndpoint[] {
  const primary = mainnetEndpoint();
  const endpoints: RpcEndpoint[] = [
    { name: "primary", url: primary.url, genesis: primary.genesis },
  ];
  const raw = process.env.SOLANA_RPC_FALLBACK_URL?.trim();
  if (!raw) return endpoints;
  const url =
    primary.fork && forkGenesisFor(raw)
      ? new URL(raw).toString()
      : assertMainnetRpcUrl(raw);
  if (url === primary.url)
    throw new AppError("SERVICE_UNAVAILABLE", {
      detail: "SOLANA_RPC_FALLBACK_URL must differ from SOLANA_RPC_URL",
    });
  endpoints.push({ name: "fallback", url, genesis: primary.genesis });
  return endpoints;
}

/** The pool over the configured endpoints (verification and cooldown state is kept per URL). */
export function mainnetPool(): RpcPool {
  return createRpcPool(mainnetEndpoints());
}

/** Any verified endpoint, failing over on transport errors only (rpc-pool.ts rules). */
export const mainnetRpc: MainnetRpc = <T>(
  method: string,
  params: unknown[] = [],
) => mainnetPool().rpc<T>(method, params);

/** Refuse anything but the expected cluster (mainnet, or the declared local fork in E2E). */
export async function assertMainnet(
  rpc: MainnetRpc = mainnetRpc,
): Promise<void> {
  const expected =
    rpc === mainnetRpc
      ? mainnetEndpoint().genesis
      : GENESIS_HASHES["mainnet-beta"];
  const genesis = await rpc<string>("getGenesisHash");
  if (genesis !== expected && !(rpc !== mainnetRpc && isForkGenesis(genesis)))
    throw new AppError("WRONG_CLUSTER", {
      detail: "The server RPC must use Solana mainnet.",
    });
}

/** Injected RPCs (tests, E2E wiring) may stand for the declared fork; nothing else. */
function isForkGenesis(genesis: string): boolean {
  const fork = process.env.AROMA_V1_TEST_FORK_GENESIS?.trim();
  return Boolean(fork) && genesis === fork && testSwitchesAllowed(process.env);
}

export const TX_V1_FEATURE = "txv1aq4pp281K9um3tnPgkfX8UqtFT6wcVW3hNezGLL";
const FEATURE_OWNER = "Feature111111111111111111111111111111111111";

export async function mainnetV1Active(
  rpc: MainnetRpc = mainnetRpc,
): Promise<boolean> {
  try {
    const [{ value }, slot] = await Promise.all([
      rpc<{ value: RpcAccount }>("getAccountInfo", [
        TX_V1_FEATURE,
        { encoding: "base64", commitment: "confirmed" },
      ]),
      rpc<number>("getSlot", [{ commitment: "confirmed" }]),
    ]);
    if (!value || value.owner !== FEATURE_OWNER) return false;
    const bytes = Buffer.from(value.data[0], "base64");
    return (
      bytes.length === 9 &&
      bytes[0] === 1 &&
      bytes.readBigUInt64LE(1) <= BigInt(slot)
    );
  } catch {
    return false;
  }
}

/** Wallet capability and live activation both gate V1; never a wallet-name guess. */
export async function selectTransactionVersion(
  supported: readonly number[],
  rpc: MainnetRpc = mainnetRpc,
): Promise<0 | 1> {
  if (!supported.some((version) => version === 0 || version === 1))
    throw new AppError("WALLET_UNSUPPORTED", {
      detail: "wallet advertises neither v0 nor v1",
    });
  await assertMainnet(rpc);
  if (supported.includes(1) && (await mainnetV1Active(rpc))) return 1;
  if (supported.includes(0)) return 0;
  throw new AppError("WALLET_UNSUPPORTED", {
    detail: "wallet is V1-only and V1 is not active on the configured RPC",
  });
}

export async function latestBlockhash(
  rpc: MainnetRpc = mainnetRpc,
): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  return (
    await rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>(
      "getLatestBlockhash",
      [{ commitment: "confirmed" }],
    )
  ).value;
}

export type SimulationResult = {
  accounts?: RpcAccount[];
  unitsConsumed?: number;
};

/**
 * Simulate an unsigned transaction against current mainnet state, reading the given accounts
 * after execution. A failure becomes SIMULATION_FAILED with the sdk's user-safe explanation;
 * raw logs stay in the server log.
 */
export async function simulateTransaction(
  transaction: string,
  addresses: readonly string[] = [],
  rpc: MainnetRpc = mainnetRpc,
): Promise<SimulationResult> {
  const result = await rpc<{
    value: {
      err: unknown;
      logs?: string[] | null;
      unitsConsumed?: number;
      accounts?: RpcAccount[];
    };
  }>("simulateTransaction", [
    transaction,
    {
      encoding: "base64",
      commitment: "confirmed",
      sigVerify: false,
      replaceRecentBlockhash: false,
      ...(addresses.length
        ? { accounts: { encoding: "base64", addresses } }
        : {}),
    },
  ]);
  if (result.value.err !== null) {
    logger.info(
      { err: result.value.err, logs: result.value.logs?.slice(-20) },
      "trade simulation failed",
    );
    throw new AppError("SIMULATION_FAILED", {
      publicMessage: describeSimulationFailure(
        result.value.err,
        result.value.logs,
      ),
      detail: "simulation returned an error",
    });
  }
  return {
    accounts: result.value.accounts,
    unitsConsumed: result.value.unitsConsumed,
  };
}
