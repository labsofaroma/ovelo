import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createKeyring } from "@/server/auth/trade";
import { authorizeTransactions } from "@/server/auth/trade-transactions";
import { GENESIS_HASHES } from "@/server/rpc";
import { signer, testKeypair, v0Transfer } from "@/server/test/transactions";
import type { MainnetRpc } from "@/features/trade/server/rpc";
import { tradeOutcome } from "@/features/trade/server/outcome";
import {
  memoryReceipts,
  memoryTradeStore,
  type TradeStore,
} from "@/features/trade/server/store";
import { submitTrade, type SubmitDeps } from "@/features/trade/server/submit";
import {
  drain,
  installGracefulShutdown,
  trackServers,
} from "../../../deploy/graceful.mjs";
import { registerShutdown, shutdownHooks } from "./shutdown";

/**
 * Phase H Step 3: the SIGTERM drain of the self-host entry point (deploy/graceful.mjs), and what
 * a trade submit cut by it leaves behind.
 */
const original = http.createServer;
afterEach(() => {
  http.createServer = original;
});

async function serve(handler: http.RequestListener) {
  const state = trackServers(http);
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return { state, server, url: `http://127.0.0.1:${port}` };
}

describe("graceful drain (deploy/graceful.mjs)", () => {
  it("stops accepting, lets an in-flight request finish, then runs the hooks", async () => {
    const order: string[] = [];
    const { state, url } = await serve((_req, res) => {
      setTimeout(() => {
        order.push("request finished");
        res.end("done");
      }, 300);
    });
    const inFlight = fetch(`${url}/slow`).then((r) => r.text());
    await new Promise((r) => setTimeout(r, 50));
    expect(state.inFlight).toBe(1);
    const result = drain(state, {
      drainMs: 5_000,
      hooks: () => [{ name: "db", close: () => void order.push("hook") }],
    });
    await new Promise((r) => setTimeout(r, 50));
    // A NEW connection is refused once draining started.
    await expect(fetch(`${url}/new`)).rejects.toThrow();
    expect(await inFlight).toBe("done");
    expect(await result).toEqual({ drained: true, hooksOk: true });
    expect(order).toEqual(["request finished", "hook"]);
  });

  it("is bounded: a request that never ends is cut at the deadline", async () => {
    const { state, url } = await serve(() => {
      /* never responds */
    });
    const hung = fetch(`${url}/hang`).catch(() => "cut");
    await new Promise((r) => setTimeout(r, 50));
    const started = Date.now();
    const result = await drain(state, { drainMs: 200, hooks: () => [] });
    expect(result.drained).toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(await hung).toBe("cut");
  });

  it("a hook that hangs or throws is bounded and reported, never blocks the exit", async () => {
    const { state } = await serve((_q, res) => res.end());
    const result = await drain(state, {
      drainMs: 100,
      hookMs: 100,
      hooks: () => [
        { name: "hangs", close: () => new Promise(() => {}) },
        {
          name: "throws",
          close: () => {
            throw new Error("boom");
          },
        },
      ],
    });
    expect(result).toEqual({ drained: true, hooksOk: false });
  });

  it("SIGTERM drains once and exits 0; the shared registry reaches the entry point", async () => {
    const { state } = await serve((_q, res) => res.end());
    let closed = 0;
    registerShutdown("test-pool", () => {
      closed++;
    });
    expect(shutdownHooks().map((h) => h.name)).toContain("test-pool");
    const exit = await new Promise<number>((resolve) => {
      const onSignal = installGracefulShutdown(state, {
        drainMs: 100,
        exit: resolve,
      });
      onSignal("SIGTERM");
      onSignal("SIGTERM"); // a second signal does not start a second drain
    });
    expect(exit).toBe(0);
    expect(closed).toBe(1);
  });
});

// --- What a submit cut by the deadline leaves behind (features/trade/server/submit.ts) ---

const keyring = createKeyring("graceful-test-trade-secret-not-for-production!");
const SIGNATURE = "1".repeat(88);

async function order() {
  const { authorization, requestId } = await authorizeTransactions(
    {
      transactions: [v0Transfer(5)],
      taker: signer.publicKey.toBase58(),
      expiresAt: Date.now() + 60_000,
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

/** One process. `send` decides what sendTransaction does; Redis (the store) survives restarts. */
function processWith(store: TradeStore, send: () => Promise<string>) {
  const sends: string[] = [];
  const rpc: MainnetRpc = async <T>(method: string): Promise<T> => {
    if (method === "getGenesisHash") return GENESIS_HASHES["mainnet-beta"] as T;
    if (method === "getBlockHeight") return 50 as T;
    if (method === "sendTransaction") {
      sends.push(method);
      return (await send()) as T;
    }
    if (method === "getSignatureStatuses")
      return {
        value: [{ err: null, confirmationStatus: "confirmed", slot: 7 }],
      } as T;
    if (method === "getBlockTime") return 1_800_000_000 as T;
    throw new Error(`unexpected ${method}`);
  };
  const deps: SubmitDeps = {
    keyring,
    rpc,
    store,
    receipts: memoryReceipts(),
    jito: null,
    sleep: async () => {},
    v1Active: async () => true,
    confirmAttempts: 2,
  };
  return { deps, sends };
}

describe("a trade submit in flight at shutdown", () => {
  it("cut mid-broadcast: the retry never broadcasts again, and the outcome settles from the chain", async () => {
    const redis = memoryTradeStore();
    const { authorization, signed, requestId } = await order();
    // Process 1 claims the request id, then dies while sendTransaction is in flight.
    const dying = processWith(redis, () => new Promise<string>(() => {}));
    void submitTrade({ authorization, signedTransactions: signed }, dying.deps);
    for (let i = 0; i < 50 && !(await redis.get(requestId)); i++)
      await new Promise((r) => setTimeout(r, 10));
    expect((await redis.get(requestId))?.status).toBe("submitting");
    // Process 2 (the new container) gets the client's retry with the same authorization.
    const next = processWith(redis, async () => SIGNATURE);
    const retried = await submitTrade(
      { authorization, signedTransactions: signed },
      next.deps,
    );
    expect(retried.id).toBe(requestId);
    expect(next.sends).toHaveLength(0); // replay: returned the stored record, no rebroadcast
    expect(await tradeOutcome(requestId, next.deps)).toBe("confirmed");
  });

  it("cut before the claim: nothing was stored, so the request id is still claimable", async () => {
    const redis = memoryTradeStore();
    const { authorization, signed, requestId } = await order();
    expect(await redis.get(requestId)).toBeNull();
    const next = processWith(redis, async () => SIGNATURE);
    const record = await submitTrade(
      { authorization, signedTransactions: signed },
      next.deps,
    );
    expect(record.id).toBe(requestId);
    expect(next.sends).toHaveLength(1);
  });
});
