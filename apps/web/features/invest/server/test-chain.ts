/**
 * Test-only chain for the invest server: a JSON-RPC transport behind kit's real RPC client, so
 * every module runs its production code paths (encoders, decoders, memcmp filters, bigint
 * conversions) against encoded v1 accounts. Never imported by production code.
 */
import {
  createSolanaRpcFromTransport,
  getBase58Encoder,
  type RpcTransport,
} from "@solana/kit";
import { DEVNET_GENESIS_HASH } from "@aroma/guard";
import type { InvestRpc } from "./cluster";

export type FakeAccount = {
  owner: string;
  data: Uint8Array;
  lamports?: bigint;
  executable?: boolean;
};

export type FakeChain = {
  accounts: Map<string, FakeAccount>;
  calls: { method: string; params: unknown[] }[];
  genesis: string;
  slot: number;
  blockTime: number;
  blockHeight: number;
  simulation: { err: unknown; logs: string[]; unitsConsumed: number };
  sent: string[];
  /** Logs returned by getTransaction for any signature, unless overridden in `transactions`. */
  transactions: Map<
    string,
    {
      logs: string[];
      err?: unknown;
      slot?: number;
      blockTime?: number;
      pre?: number[];
      post?: number[];
    }
  >;
  signatures: Map<string, { signature: string; err: unknown }[]>;
  statusError: unknown;
  fail: Set<string>;
};

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

function matches(
  data: Uint8Array,
  filters: { memcmp: { offset: number | bigint; bytes: string } }[],
) {
  return filters.every(({ memcmp }) => {
    const want = getBase58Encoder().encode(memcmp.bytes);
    const at = Number(memcmp.offset);
    return want.every((byte, i) => data[at + i] === byte);
  });
}

function account(entry: FakeAccount) {
  return {
    data: [b64(entry.data), "base64"],
    executable: entry.executable ?? false,
    lamports: Number(entry.lamports ?? 2_039_280n),
    owner: entry.owner,
    rentEpoch: 0,
    space: entry.data.length,
  };
}

export function fakeChain(
  overrides: Partial<FakeChain> = {},
): FakeChain & { rpc: InvestRpc; transport: RpcTransport } {
  const chain: FakeChain = {
    accounts: new Map(),
    calls: [],
    genesis: DEVNET_GENESIS_HASH,
    slot: 1_000,
    blockTime: 1_763_100_000,
    blockHeight: 500,
    simulation: {
      err: null,
      logs: ["Program log: ok"],
      unitsConsumed: 120_000,
    },
    sent: [],
    transactions: new Map(),
    signatures: new Map(),
    statusError: null,
    fail: new Set(),
    ...overrides,
  };
  const ctx = { value: null as unknown, context: { slot: chain.slot } };
  const transport: RpcTransport = async <T>({
    payload,
  }: {
    payload: unknown;
  }) => {
    const {
      method,
      params = [],
      id,
    } = payload as { method: string; params?: unknown[]; id: number };
    chain.calls.push({ method, params });
    const reply = (result: unknown) =>
      ({ jsonrpc: "2.0", id, result }) as unknown as T;
    if (chain.fail.has(method)) throw new Error(`${method} unavailable`);
    switch (method) {
      case "getGenesisHash":
        return reply(chain.genesis);
      case "getSlot":
        return reply(chain.slot);
      case "getBlockTime":
        return reply(chain.blockTime);
      case "getBlockHeight":
        return reply(chain.blockHeight);
      case "getLatestBlockhash":
        return reply({
          ...ctx,
          value: {
            blockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k",
            lastValidBlockHeight: chain.blockHeight + 150,
          },
        });
      case "getAccountInfo": {
        const entry = chain.accounts.get(params[0] as string);
        return reply({ ...ctx, value: entry ? account(entry) : null });
      }
      case "getProgramAccounts": {
        const [program, config] = params as [
          string,
          { filters?: { memcmp: { offset: number; bytes: string } }[] },
        ];
        const list = [...chain.accounts.entries()]
          .filter(
            ([, a]) =>
              a.owner === program && matches(a.data, config.filters ?? []),
          )
          .map(([pubkey, a]) => ({ pubkey, account: account(a) }));
        return reply(list);
      }
      case "simulateTransaction":
        return reply({
          ...ctx,
          value: { ...chain.simulation, accounts: null, returnData: null },
        });
      case "sendTransaction": {
        chain.sent.push(params[0] as string);
        return reply(`sig${chain.sent.length}`.padEnd(88, "1"));
      }
      case "getSignatureStatuses":
        return reply({
          ...ctx,
          value: (params[0] as string[]).map(() => ({
            slot: chain.slot,
            confirmations: 1,
            err: chain.statusError,
            confirmationStatus: "confirmed",
            status: chain.statusError
              ? { Err: chain.statusError }
              : { Ok: null },
          })),
        });
      case "getTransaction": {
        const tx =
          chain.transactions.get(params[0] as string) ??
          chain.transactions.get("*");
        if (!tx) return reply(null);
        return reply({
          slot: tx.slot ?? chain.slot,
          blockTime: tx.blockTime ?? chain.blockTime,
          meta: {
            err: tx.err ?? null,
            logMessages: tx.logs,
            preBalances: tx.pre ?? [10_000_000],
            postBalances: tx.post ?? [9_995_000],
            fee: 5000,
            innerInstructions: [],
            loadedAddresses: { readonly: [], writable: [] },
            preTokenBalances: [],
            postTokenBalances: [],
            rewards: [],
            status: { Ok: null },
            computeUnitsConsumed: 1,
          },
          transaction: {
            message: {
              accountKeys: [],
              header: {
                numRequiredSignatures: 1,
                numReadonlySignedAccounts: 0,
                numReadonlyUnsignedAccounts: 0,
              },
              instructions: [],
              recentBlockhash: "11111111111111111111111111111111",
            },
            signatures: [params[0]],
          },
          version: 0,
        });
      }
      case "getSignaturesForAddress":
        return reply(
          (chain.signatures.get(params[0] as string) ?? []).map((s) => ({
            ...s,
            slot: chain.slot,
            blockTime: chain.blockTime,
            memo: null,
            confirmationStatus: "confirmed",
          })),
        );
      default:
        throw new Error(`fake chain: unexpected ${method}`);
    }
  };
  return Object.assign(chain, {
    rpc: createSolanaRpcFromTransport(transport),
    transport,
  });
}
