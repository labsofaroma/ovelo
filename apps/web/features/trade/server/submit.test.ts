import { beforeEach, describe, expect, it } from "vitest";
import { walletTransactionSignature } from "@/lib/sdk/baskets/mainnet";
import { createKeyring } from "@/server/auth/trade";
import { authorizeTransactions } from "@/server/auth/trade-transactions";
import { GENESIS_HASHES } from "@/server/rpc";
import { signer, testKeypair, v0Transfer } from "@/server/test/transactions";
import { RpcError, type MainnetRpc } from "./rpc";
import { memoryReceipts, memoryTradeStore } from "./store";
import { getTrade, submitTrade, type SubmitDeps } from "./submit";

/**
 * Ported from tests/single-execution-recovery.test.ts, plus the v1 submit contract: idempotent
 * per request id (no second broadcast), expired and tampered authorizations refused before any
 * RPC call, and receipts written as pending then confirmed.
 */
const keyring = createKeyring("submit-test-trade-secret-not-for-production!");
const taker = signer.publicKey.toBase58();
const SIGNATURE = "1".repeat(88);

async function order(expiresAt = Date.now() + 60_000) {
  const unsigned = v0Transfer(5);
  const { authorization, requestId } = await authorizeTransactions(
    {
      transactions: [unsigned],
      taker,
      expiresAt,
      lastValidBlockHeight: 100,
      receipt: {
        kind: "spot",
        basketId: null,
        inputMint: testKeypair(2).publicKey.toBase58(),
        inAmount: "1000050",
        legs: [
          {
            mint: testKeypair(4).publicKey.toBase58(),
            inputAmount: "1000000",
            outAmount: "10",
            minimumAmount: "9",
            tx: 0,
          },
        ],
      },
    },
    keyring,
  );
  return {
    authorization,
    requestId,
    signed: [v0Transfer(5, { signed: true })],
  };
}

function harness(
  overrides: { statuses?: () => unknown; height?: number } = {},
) {
  const calls: string[] = [];
  const rpc: MainnetRpc = async <T>(method: string): Promise<T> => {
    calls.push(method);
    if (method === "getGenesisHash") return GENESIS_HASHES["mainnet-beta"] as T;
    if (method === "getBlockHeight") return (overrides.height ?? 50) as T;
    if (method === "sendTransaction") return SIGNATURE as T;
    if (method === "getSignatureStatuses") {
      if (overrides.statuses) return overrides.statuses() as T;
      return {
        value: [{ err: null, confirmationStatus: "confirmed", slot: 7 }],
      } as T;
    }
    if (method === "getBlockTime") return 1_800_000_000 as T;
    throw new Error(`unexpected ${method}`);
  };
  const store = memoryTradeStore();
  const receipts = memoryReceipts();
  const deps: SubmitDeps = {
    keyring,
    rpc,
    store,
    receipts,
    jito: null,
    sleep: async () => {},
    v1Active: async () => true,
    confirmAttempts: 2,
  };
  return { calls, deps, store, receipts };
}

describe("submitTrade", () => {
  let run: ReturnType<typeof harness>;
  beforeEach(() => {
    run = harness();
  });

  it("broadcasts once, confirms and writes a confirmed receipt with raw-integer amounts", async () => {
    const { authorization, signed, requestId } = await order();
    const record = await submitTrade(
      { authorization, signedTransactions: signed },
      run.deps,
    );
    expect(record.id).toBe(requestId);
    expect(record.status).toBe("confirmed");
    expect(run.calls.filter((c) => c === "sendTransaction")).toHaveLength(1);
    const rows = await run.receipts.listByWallet(taker, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "confirmed",
      kind: "spot",
      amountIn: "1000000",
      slot: 7n,
    });
  });

  it("is idempotent: the same request is never broadcast twice (replay)", async () => {
    const { authorization, signed } = await order();
    const first = await submitTrade(
      { authorization, signedTransactions: signed },
      run.deps,
    );
    const second = await submitTrade(
      { authorization, signedTransactions: signed },
      run.deps,
    );
    expect(second.id).toBe(first.id);
    expect(run.calls.filter((c) => c === "sendTransaction")).toHaveLength(1);
  });

  it("an expired quote is refused before any RPC call", async () => {
    const { authorization, signed } = await order(Date.now() - 1);
    await expect(
      submitTrade({ authorization, signedTransactions: signed }, run.deps),
    ).rejects.toMatchObject({ code: "QUOTE_EXPIRED" });
    expect(run.calls).toEqual([]);
  });

  it("a tampered authorization is refused before any RPC call", async () => {
    const { authorization, signed } = await order();
    const tampered = authorization.slice(0, -2) + "AA";
    await expect(
      submitTrade(
        { authorization: tampered, signedTransactions: signed },
        run.deps,
      ),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_INVALID" });
    expect(run.calls).toEqual([]);
  });

  it("an expired blockhash is refused and nothing is broadcast", async () => {
    const expired = harness({ height: 101 });
    const { authorization, signed } = await order();
    await expect(
      submitTrade({ authorization, signedTransactions: signed }, expired.deps),
    ).rejects.toMatchObject({ code: "BLOCKHASH_EXPIRED" });
    expect(expired.calls).not.toContain("sendTransaction");
  });

  it("a receipt RPC rejection after an acknowledged broadcast stays unknown and keeps the signature", async () => {
    const lost = harness({
      statuses: () => {
        throw new RpcError("Receipt provider unavailable");
      },
    });
    const { authorization, signed } = await order();
    const record = await submitTrade(
      { authorization, signedTransactions: signed },
      lost.deps,
    );
    expect(record.status).toBe("unknown");
    // Derived from the signed bytes before broadcast, so recovery never depends on the RPC reply.
    expect(record.signatures).toEqual([
      await walletTransactionSignature(signed[0]!),
    ]);
    expect(lost.calls).toEqual([
      "getGenesisHash",
      "getBlockHeight",
      "sendTransaction",
      "getSignatureStatuses",
    ]);
    // Never counted as confirmed while unknown.
    const rows = await lost.receipts.listByWallet(taker, 10);
    expect(rows[0]?.status).toBe("pending");
  });

  it("an on-chain failure is reported as failed with its receipt marked failed", async () => {
    const failing = harness({
      statuses: () => ({
        value: [
          {
            err: { InstructionError: [2, { Custom: 6001 }] },
            confirmationStatus: "confirmed",
            slot: 9,
          },
        ],
      }),
    });
    const { authorization, signed } = await order();
    const record = await submitTrade(
      { authorization, signedTransactions: signed },
      failing.deps,
    );
    expect(record.status).toBe("failed");
    expect(record.error?.code).toBe("TRANSACTION_FAILED");
    expect((await failing.receipts.listByWallet(taker, 10))[0]?.status).toBe(
      "failed",
    );
  });

  it("getTrade tracks a pending trade to confirmation", async () => {
    let confirmed = false;
    const later = harness({
      statuses: () => ({
        value: [
          confirmed
            ? { err: null, confirmationStatus: "finalized", slot: 11 }
            : null,
        ],
      }),
    });
    const { authorization, signed, requestId } = await order();
    const record = await submitTrade(
      { authorization, signedTransactions: signed },
      later.deps,
    );
    expect(record.status).toBe("pending");
    confirmed = true;
    const tracked = await getTrade(requestId, later.deps);
    expect(tracked?.status).toBe("confirmed");
    expect(
      await getTrade("8f0e3c7a-3d4b-4b8e-9c2a-000000000000", later.deps),
    ).toBeNull();
  });
});
