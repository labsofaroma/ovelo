import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createKeyring } from "@/server/auth/trade";
import { authorizeTransactions } from "@/server/auth/trade-transactions";
import { GENESIS_HASHES } from "@/server/rpc";
import { signer, testKeypair, v0Transfer } from "@/server/test/transactions";
import type { SubmitDeps } from "./submit";
import type { Behaviour } from "./test-network";

vi.mock("@/server/telemetry", () => ({
  alertEvent: () => {},
  tradeEvent: () => {},
}));
const { createRpcPool, resetRpcPoolForTests } = await import("./rpc-pool");
const { memoryReceipts, memoryTradeStore } = await import("./store");
const { submitTrade, getTrade, EXPIRY_DECISION_WINDOW } =
  await import("./submit");
const { network } = await import("./test-network");

/**
 * M9 failover on the submit path, with the real pool over a fake network: the same signed bytes
 * may move to the other endpoint only after a transport failure; a JSON-RPC refusal is final;
 * after an uncertain first send nothing is ever called "failed"; polling stops at the blockhash's
 * last valid height.
 */
const keyring = createKeyring("failover-test-trade-secret-not-for-production!");
const taker = signer.publicKey.toBase58();
const MAINNET = GENESIS_HASHES["mainnet-beta"];
const PRIMARY = "https://primary.example/";
const FALLBACK = "https://fallback.example/";
const LAST_VALID = 100;
const ENDPOINTS = [
  { name: "primary" as const, url: PRIMARY, genesis: MAINNET },
  { name: "fallback" as const, url: FALLBACK, genesis: MAINNET },
];

async function order() {
  const { authorization } = await authorizeTransactions(
    {
      transactions: [v0Transfer(5)],
      taker,
      expiresAt: Date.now() + 60_000,
      lastValidBlockHeight: LAST_VALID,
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
  return { authorization, signed: v0Transfer(5, { signed: true }) };
}

type Chain = { landed: boolean; height: number };
/** A node's answers when it behaves: block height, statuses from the shared chain, a signature. */
const answer = (chain: Chain) => (method: string) => {
  if (method === "getBlockHeight") return chain.height;
  if (method === "sendTransaction") {
    chain.landed = true;
    return "1".repeat(88);
  }
  if (method === "getSignatureStatuses")
    return {
      value: [
        chain.landed
          ? { err: null, confirmationStatus: "confirmed", slot: 7 }
          : null,
      ],
    };
  if (method === "getBlockTime") return 1_800_000_000;
  return null;
};

function deps(
  fetchImpl: typeof fetch,
  endpoints = ENDPOINTS,
): SubmitDeps & { receipts: ReturnType<typeof memoryReceipts> } {
  const pool = createRpcPool(endpoints, { fetch: fetchImpl });
  const rpc = pool.pinned();
  return {
    keyring,
    rpc,
    store: memoryTradeStore(),
    receipts: memoryReceipts(),
    jito: null,
    v1Active: async () => true,
    sleep: async () => {},
    confirmAttempts: 2,
    resend: () =>
      pool.on(rpc.endpoint() === "fallback" ? "primary" : "fallback"),
    reads: () => pool.pinned(),
  };
}

const sends = <C extends { method: string }>(log: C[]) =>
  log.filter((c) => c.method === "sendTransaction");

afterEach(() => resetRpcPoolForTests());

describe("submit failover", () => {
  it("primary dies between preflight and send: the same bytes go to the fallback and confirm", async () => {
    const chain = { landed: false, height: 50 };
    const net = network({
      [PRIMARY]: {
        genesis: MAINNET,
        behave: (m) => (m === "sendTransaction" ? "transport" : "ok"),
        answer: answer(chain),
      },
      [FALLBACK]: {
        genesis: MAINNET,
        behave: () => "ok",
        answer: answer(chain),
      },
    });
    const { authorization, signed } = await order();
    const record = await submitTrade(
      { authorization, signedTransactions: [signed] },
      deps(net.fetch),
    );
    expect(record.status).toBe("confirmed");
    expect(sends(net.log).map((c) => c.url)).toEqual([PRIMARY, FALLBACK]);
    for (const call of sends(net.log))
      expect((call.params as unknown[])[0]).toBe(signed);
  });

  it("a JSON-RPC refusal of the send is final: failed, and the fallback is never asked", async () => {
    const chain = { landed: false, height: 50 };
    const net = network({
      [PRIMARY]: {
        genesis: MAINNET,
        behave: (m) => (m === "sendTransaction" ? "rpc-error" : "ok"),
        answer: answer(chain),
      },
      [FALLBACK]: {
        genesis: MAINNET,
        behave: () => "ok",
        answer: answer(chain),
      },
    });
    const { authorization, signed } = await order();
    const record = await submitTrade(
      { authorization, signedTransactions: [signed] },
      deps(net.fetch),
    );
    expect(record.status).toBe("failed");
    expect(record.error?.code).toBe("SIMULATION_FAILED");
    expect(net.log.filter((c) => c.url === FALLBACK)).toEqual([]);
  });

  it.each(["rpc-error", "transport"] as const)(
    "after an uncertain first send, a re-send that ends in %s is unknown, never failed",
    async (second) => {
      const chain = { landed: false, height: 50 };
      const net = network({
        [PRIMARY]: {
          genesis: MAINNET,
          behave: (m) =>
            m === "sendTransaction" || m === "getSignatureStatuses"
              ? "transport"
              : "ok",
          answer: answer(chain),
        },
        [FALLBACK]: {
          genesis: MAINNET,
          // Verified (genesis ok), then the re-send ends in `second`; every read fails.
          behave: (m) =>
            m === "sendTransaction"
              ? second
              : m === "getGenesisHash"
                ? "ok"
                : "transport",
          answer: answer(chain),
        },
      });
      const { authorization, signed } = await order();
      const run = deps(net.fetch);
      const record = await submitTrade(
        { authorization, signedTransactions: [signed] },
        run,
      );
      expect(record.status).toBe("unknown");
      expect(sends(net.log)).toHaveLength(2);
      expect((await run.receipts.listByWallet(taker, 5))[0]?.status).toBe(
        "pending",
      );
    },
  );

  it("without a fallback, a transport failure of the send is unknown (one send)", async () => {
    const chain = { landed: false, height: 50 };
    const net = network({
      [PRIMARY]: {
        genesis: MAINNET,
        behave: (m) => (m === "sendTransaction" ? "http503" : "ok"),
        answer: answer(chain),
      },
    });
    const { authorization, signed } = await order();
    const record = await submitTrade(
      { authorization, signedTransactions: [signed] },
      deps(net.fetch, [ENDPOINTS[0]!]),
    );
    expect(record.status).toBe("unknown");
    expect(sends(net.log)).toHaveLength(1);
  });

  it("a non-failover failure of the send (HTTP 401 page) is unknown and is not re-sent", async () => {
    const chain = { landed: false, height: 50 };
    const net = network({
      [PRIMARY]: {
        genesis: MAINNET,
        behave: (m) => (m === "sendTransaction" ? "http401-html" : "ok"),
        answer: answer(chain),
      },
      [FALLBACK]: {
        genesis: MAINNET,
        behave: () => "ok",
        answer: answer(chain),
      },
    });
    const { authorization, signed } = await order();
    const record = await submitTrade(
      { authorization, signedTransactions: [signed] },
      deps(net.fetch),
    );
    expect(record.status).toBe("unknown");
    expect(sends(net.log)).toHaveLength(1);
  });
});

describe("confirmation polling stops at lastValidBlockHeight", () => {
  async function pending(chain: Chain) {
    const net = network({
      [PRIMARY]: {
        genesis: MAINNET,
        // The send is accepted but the transaction never lands (dropped by the cluster).
        behave: () => "ok",
        answer: (m) =>
          m === "sendTransaction" ? "1".repeat(88) : answer(chain)(m),
      },
      [FALLBACK]: {
        genesis: MAINNET,
        behave: () => "ok",
        answer: answer(chain),
      },
    });
    const { authorization, signed } = await order();
    const run = deps(net.fetch);
    const record = await submitTrade(
      { authorization, signedTransactions: [signed] },
      run,
    );
    return { record, run };
  }

  it("no status while the blockhash is valid: still pending", async () => {
    const { record } = await pending({ landed: false, height: LAST_VALID });
    expect(record.status).toBe("pending");
  });

  it("no status and the chain is past the last valid height: failed (it can never land)", async () => {
    const chain = { landed: false, height: LAST_VALID };
    const { record, run } = await pending(chain);
    chain.height = LAST_VALID + 1;
    const final = await getTrade(record.id, run);
    expect(final).toMatchObject({
      status: "failed",
      error: { code: "BLOCKHASH_EXPIRED" },
    });
    expect((await run.receipts.listByWallet(taker, 5))[0]?.status).toBe(
      "failed",
    );
    // Final: no further chain reads for this trade.
    expect(await getTrade(record.id, run)).toMatchObject({ status: "failed" });
  });

  it("long past the expiry a missing status proves nothing (no history, a silent lookup failure): never failed", async () => {
    const chain = { landed: false, height: LAST_VALID };
    const { record, run } = await pending(chain);
    chain.height = LAST_VALID + EXPIRY_DECISION_WINDOW + 1;
    expect(await getTrade(record.id, run)).toMatchObject({ status: "pending" });
    expect((await run.receipts.listByWallet(taker, 5))[0]?.status).toBe(
      "pending",
    );
  });
});

describe("properties", () => {
  const behaviours: Behaviour[] = [
    "ok",
    "transport",
    "timeout",
    "http500",
    "http503",
    "http429",
    "http401-html",
    "rpc-error",
  ];
  // Mostly "ok", so random scripts reach the send (3 calls of preflight first) often enough.
  const behaviour = fc.oneof(
    { arbitrary: fc.constant<Behaviour>("ok"), weight: 6 },
    { arbitrary: fc.constantFrom(...behaviours.slice(1)), weight: 2 },
  );
  /** Each endpoint plays a random script of behaviours, one per call (then "ok"). */
  const scripted = (script: Behaviour[]) => {
    let i = 0;
    return () => script[i++] ?? "ok";
  };

  it("for any sequence of failures, every sendTransaction carries the signed bytes, and a refused send is never sent again", async () => {
    const { authorization, signed } = await order();
    await fc.assert(
      fc.asyncProperty(
        fc.array(behaviour, { maxLength: 12 }),
        fc.array(behaviour, { maxLength: 12 }),
        async (primary, fallback) => {
          resetRpcPoolForTests();
          const chain = { landed: false, height: 50 };
          const net = network({
            [PRIMARY]: {
              genesis: MAINNET,
              behave: scripted(primary),
              answer: answer(chain),
            },
            [FALLBACK]: {
              genesis: MAINNET,
              behave: scripted(fallback),
              answer: answer(chain),
            },
          });
          const run = deps(net.fetch);
          const record = await submitTrade(
            { authorization, signedTransactions: [signed] },
            run,
          ).catch(() => null);
          const all = sends(net.log);
          for (const call of all)
            expect((call.params as unknown[])[0]).toBe(signed);
          expect(all.length).toBeLessThanOrEqual(2);
          // A JSON-RPC refusal of a send is final: nothing is sent after it.
          const refused = all.findIndex((c) => c.outcome === "rpc-error");
          if (refused !== -1) expect(refused).toBe(all.length - 1);
          // "failed" from a send refusal only when the FIRST send was refused (nothing uncertain).
          if (record?.error?.code === "SIMULATION_FAILED")
            expect(all[0]?.outcome).toBe("rpc-error");
        },
      ),
      { numRuns: 300 },
    );
  }, 60_000); // 300 runs: well under 5 s alone, slower under the full parallel suite

  it("for any sequence of failures, the pool never retries a JSON-RPC error answer elsewhere", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(behaviour, { maxLength: 8 }),
        fc.array(behaviour, { maxLength: 8 }),
        fc.constantFrom(
          "simulateTransaction",
          "sendTransaction",
          "getLatestBlockhash",
        ),
        async (primary, fallback, method) => {
          resetRpcPoolForTests();
          const net = network({
            [PRIMARY]: { genesis: MAINNET, behave: scripted(primary) },
            [FALLBACK]: { genesis: MAINNET, behave: scripted(fallback) },
          });
          const pool = createRpcPool(ENDPOINTS, { fetch: net.fetch });
          await pool.rpc(method, ["payload"]).catch(() => null);
          const answered = net.log.filter((c) => c.method === method);
          const refused = answered.findIndex((c) => c.outcome === "rpc-error");
          if (refused !== -1) expect(refused).toBe(answered.length - 1);
          // Never more than one try per endpoint for one request.
          expect(answered.length).toBeLessThanOrEqual(2);
        },
      ),
      { numRuns: 400 },
    );
  }, 60_000);
});
