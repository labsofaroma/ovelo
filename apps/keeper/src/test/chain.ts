/** Test-only chain for the keeper: kit's real RPC client over a fake JSON-RPC transport. */
import {
  createSolanaRpcFromTransport,
  getBase58Decoder,
  getBase58Encoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type RpcTransport,
} from "@solana/kit";
import { DEVNET_GENESIS_HASH, V1_PROGRAM_ID } from "@ovelo/guard";
import type { KeeperRpc } from "../rpc";

export type FakeAccount = {
  owner: string;
  data: Uint8Array;
  lamports?: bigint;
};

export type FakeKeeperChain = {
  accounts: Map<string, FakeAccount>;
  calls: { method: string; params: unknown[] }[];
  genesis: string;
  slot: number;
  blockTime: number;
  balance: bigint;
  /** Programs called by each sent transaction, in order. */
  sent: string[][];
  /** Simulation result per call (shifted); default ok. */
  simulations: { err: unknown; logs?: string[] }[];
  /** Thrown by sendTransaction while > 0 (transient failure), then decremented. */
  sendFailures: number;
  statusError: unknown;
  /** Logs for a confirmed transaction, from the programs it called. */
  logsFor(programs: string[]): string[];
  fail: Set<string>;
};

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

function account(entry: FakeAccount) {
  return {
    data: [b64(entry.data), "base64"],
    executable: false,
    lamports: Number(entry.lamports ?? 2_039_280n),
    owner: entry.owner,
    rentEpoch: 0,
    space: entry.data.length,
  };
}

function matches(
  data: Uint8Array,
  filters: { memcmp: { offset: number; bytes: string } }[],
) {
  return filters.every(({ memcmp }) =>
    getBase58Encoder()
      .encode(memcmp.bytes)
      .every((byte, i) => data[Number(memcmp.offset) + i] === byte),
  );
}

function decodeSent(wire: string): { signature: string; programs: string[] } {
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(wire));
  const message = getCompiledTransactionMessageDecoder().decode(
    tx.messageBytes,
  );
  const feePayer = message.staticAccounts[0]!;
  const signature = tx.signatures[feePayer];
  const ixs = "instructions" in message ? message.instructions : [];
  return {
    signature: getBase58Decoder().decode(signature ?? new Uint8Array(64)),
    programs: ixs.map((ix) => message.staticAccounts[ix.programAddressIndex]!),
  };
}

export function fakeKeeperChain(
  overrides: Partial<FakeKeeperChain> = {},
): FakeKeeperChain & { rpc: KeeperRpc; transport: RpcTransport } {
  const chain: FakeKeeperChain = {
    accounts: new Map(),
    calls: [],
    genesis: DEVNET_GENESIS_HASH,
    slot: 2_000,
    blockTime: 1_763_100_000,
    balance: 5_000_000_000n,
    sent: [],
    simulations: [],
    sendFailures: 0,
    statusError: null,
    logsFor: () => [],
    fail: new Set(),
    ...overrides,
  };
  const logsBySignature = new Map<string, string[]>();
  const ctx = () => ({ context: { slot: chain.slot } });
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
        return reply(100);
      case "getBalance":
        return reply({ ...ctx(), value: Number(chain.balance) });
      case "getMinimumBalanceForRentExemption":
        return reply(1_500_000);
      case "getLatestBlockhash":
        return reply({
          ...ctx(),
          value: {
            blockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k",
            lastValidBlockHeight: 250,
          },
        });
      case "getAccountInfo": {
        const entry = chain.accounts.get(params[0] as string);
        return reply({ ...ctx(), value: entry ? account(entry) : null });
      }
      case "getMultipleAccounts": {
        const list = (params[0] as string[]).map((a) => chain.accounts.get(a));
        return reply({
          ...ctx(),
          value: list.map((e) => (e ? account(e) : null)),
        });
      }
      case "getProgramAccounts": {
        const [program, config] = params as [
          string,
          { filters?: { memcmp: { offset: number; bytes: string } }[] },
        ];
        return reply(
          [...chain.accounts.entries()]
            .filter(
              ([, a]) =>
                a.owner === program && matches(a.data, config.filters ?? []),
            )
            .map(([pubkey, a]) => ({ pubkey, account: account(a) })),
        );
      }
      case "simulateTransaction": {
        const next = chain.simulations.shift() ?? { err: null };
        return reply({
          ...ctx(),
          value: {
            err: next.err,
            logs: next.logs ?? [],
            unitsConsumed: 150_000,
            accounts: null,
            returnData: null,
          },
        });
      }
      case "sendTransaction": {
        if (chain.sendFailures > 0) {
          chain.sendFailures -= 1;
          throw new Error("node is behind");
        }
        const { signature, programs } = decodeSent(params[0] as string);
        chain.sent.push(programs);
        logsBySignature.set(signature, chain.logsFor(programs));
        return reply(signature);
      }
      case "getSignatureStatuses":
        return reply({
          ...ctx(),
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
      case "getTransaction":
        return reply({
          slot: chain.slot,
          blockTime: chain.blockTime,
          meta: {
            err: null,
            logMessages: logsBySignature.get(params[0] as string) ?? [],
            preBalances: [],
            postBalances: [],
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
      default:
        throw new Error(`fake keeper chain: unexpected ${method}`);
    }
  };
  return Object.assign(chain, {
    rpc: createSolanaRpcFromTransport(transport),
    transport,
  });
}

/** `Program data:` lines framed by the v1 program's invoke/success lines. */
export function v1Logs(...events: Uint8Array[]): string[] {
  return [
    `Program ${V1_PROGRAM_ID} invoke [1]`,
    ...events.map((e) => `Program data: ${b64(e)}`),
    `Program ${V1_PROGRAM_ID} success`,
  ];
}
