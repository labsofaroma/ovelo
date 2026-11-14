import type { PGlite } from "@electric-sql/pglite";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createTestDb } from "@/features/creators/test/db";
import { authorizationFor } from "@/features/beta/test/fixtures";
import { toMarketsView } from "@/features/markets/normalize";
import { snapshot } from "@/features/test/fixtures";
import { SOL_MINT, USDC_MINT } from "@/features/trade/schema";
import { resetEnvCacheForTests } from "@/server/env";
import { setCapsDepsForTests } from "./server/deps";
import { reservationOf, usedOn, type CapsDb } from "./server/store";
import { utcDay } from "./config";

/**
 * W3 at route level (real caps on PGlite; the trade service, location, beta and terms gates are
 * covered elsewhere and stubbed here): quote refuses above the per-trade cap and past the day,
 * returns the server's figures; submit reserves per authorization (a replay counts once),
 * releases on failure, keeps on confirm; the Action reserves and keeps; failures fail closed.
 */
const service = vi.hoisted(() => ({
  quoteTrade: vi.fn(),
  submitSignedTrade: vi.fn(),
  tradeStatus: vi.fn(),
  publicRecord: (r: unknown) => r,
}));
vi.mock("@/features/trade/server/service", () => service);
vi.mock("@/features/beta/server/gate", () => ({
  assertTradeAccess: vi.fn(async () => {}),
  assertBetaAccess: vi.fn(async () => {}),
}));
vi.mock("@/features/compliance/server/gate", () => ({
  assertJurisdiction: vi.fn(),
  requestJurisdiction: vi.fn(() => ({ status: "allowed", country: "DE" })),
}));
vi.mock("@/features/compliance/server/deps", () => ({
  complianceDeps: () => ({ policy: () => ({}) }),
}));
vi.mock("@/features/markets/server", () => ({
  getMarkets: async () => ({ state: "ok", data: toMarketsView(snapshot()) }),
}));

const quote = await import("@/app/api/v1/trade/quote/route");
const submit = await import("@/app/api/v1/trade/submit/route");
const status = await import("@/app/api/v1/trade/[id]/route");
const action = await import("@/app/api/v1/actions/baskets/[id]/route");

const SITE = "https://aroma.example";
const WALLET = "4Nd1mYQzvgp7uVDYiHn9wrpTkMtZpZyV9pR9ZJ2q5vPz";
const post = (path: string, body: unknown) =>
  new Request(`${SITE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const quoteBody = (amount: string, inputMint = USDC_MINT) => ({
  target: { kind: "basket", basketId: "test-basket" },
  inputMint,
  amount,
  taker: WALLET,
  supportedTransactionVersions: [0],
});
const prepared = (maxDebit: string, requestId = crypto.randomUUID()) => ({
  requestId,
  transactions: ["AA"],
  expiresAt: Date.now() + 60_000,
  quote: { inputMint: USDC_MINT, maxDebit },
});

let db: CapsDb;
let client: PGlite;
let dbDown = false;
let outcome: "confirmed" | "failed" | "open" = "open";
beforeAll(async () => {
  ({ db, client } = await createTestDb());
});
afterAll(async () => client.close());
beforeEach(() => {
  vi.stubEnv("AROMA_V1_ENABLED", "true");
  vi.stubEnv("AROMA_TRADE_SECRET", "s".repeat(40));
  vi.stubEnv("SOLANA_RPC_URL", "https://rpc.example.test");
  vi.stubEnv("DATABASE_URL", "postgres://u:p@db.example.test/aroma");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example.test");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
  resetEnvCacheForTests();
  dbDown = false;
  outcome = "open";
  setCapsDepsForTests({
    env: () => ({
      AROMA_MAX_TRADE_USDC_RAW: "50000000",
      AROMA_MAX_DAILY_USDC_RAW: "200000000",
    }),
    db: () => {
      if (dbDown) throw new Error("connection refused");
      return db;
    },
    price: async () => ({ raw: "10000000000", decimals: 8 }), // $100 per SOL
    outcome: async () => outcome,
  });
  service.quoteTrade.mockReset();
  service.submitSignedTrade.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCacheForTests();
  setCapsDepsForTests({});
});

// Each test uses a fresh wallet day by moving the authorization's taker; quotes use WALLET.
const fresh = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return `${WALLET.slice(0, 36)}${Array.from(bytes, (b) => "abcdefgh"[b % 8]).join("")}${WALLET.slice(40)}`;
};

describe("quote", () => {
  it("returns the server's limits with the quote", async () => {
    service.quoteTrade.mockResolvedValue(prepared("10000000"));
    const response = await quote.POST(
      post("/api/v1/trade/quote", quoteBody("10")),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.limits).toMatchObject({
      perTradeRaw: "50000000",
      dailyRaw: "200000000",
      notionalRaw: "10000000",
      day: utcDay(new Date()),
    });
    expect(BigInt(body.limits.remainingTodayRaw)).toBe(
      200_000_000n - BigInt(body.limits.usedTodayRaw),
    );
  });

  it("above the per-trade cap → 422 TRADE_CAP_EXCEEDED before any route is built", async () => {
    const response = await quote.POST(
      post("/api/v1/trade/quote", quoteBody("50.000001")),
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      code: "TRADE_CAP_EXCEEDED",
      message: expect.stringContaining("limited to $50"),
    });
    expect(service.quoteTrade).not.toHaveBeenCalled();
  });

  it("the authorized maximum debit is what counts (a basket's legs together)", async () => {
    service.quoteTrade.mockResolvedValue(prepared("50000001"));
    const response = await quote.POST(
      post("/api/v1/trade/quote", quoteBody("50")),
    );
    expect((await response.json()).code).toBe("TRADE_CAP_EXCEEDED");
  });

  it("SOL input is valued with the price path ($100/SOL: 0.6 SOL = $60 > $50)", async () => {
    const response = await quote.POST(
      post("/api/v1/trade/quote", quoteBody("0.6", SOL_MINT)),
    );
    expect((await response.json()).code).toBe("TRADE_CAP_EXCEEDED");
  });

  it("no price, no database or no configuration fails closed (503)", async () => {
    setCapsDepsForTests({
      env: () => ({}),
      db: () => db,
      price: async () => null,
      outcome: async () => "open",
    });
    expect(
      (
        await (
          await quote.POST(
            post("/api/v1/trade/quote", quoteBody("1", SOL_MINT)),
          )
        ).json()
      ).code,
    ).toBe("TRADE_CAP_UNAVAILABLE");
    setCapsDepsForTests({
      env: () => ({ NODE_ENV: "production" }),
      db: () => db,
      price: async () => null,
      outcome: async () => "open",
    });
    expect(
      (
        await (
          await quote.POST(post("/api/v1/trade/quote", quoteBody("1")))
        ).json()
      ).code,
    ).toBe("TRADE_CAP_UNAVAILABLE");
  });
});

describe("submit", () => {
  const body = (taker: string) => ({
    authorization: authorizationFor(taker),
    signedTransactions: ["AAAA"],
  });
  const idOf = (auth: string) =>
    (
      JSON.parse(Buffer.from(auth.split(".")[2]!, "base64url").toString()) as {
        requestId: string;
      }
    ).requestId;

  it("reserves once per authorization; a replay does not count twice; confirm keeps it", async () => {
    const taker = fresh();
    const request = body(taker);
    service.submitSignedTrade.mockResolvedValue({ status: "pending" });
    expect(
      (await submit.POST(post("/api/v1/trade/submit", request))).status,
    ).toBe(202);
    expect(
      (await submit.POST(post("/api/v1/trade/submit", request))).status,
    ).toBe(202);
    const day = utcDay(new Date());
    expect(await usedOn(db, taker, day)).toBe(1_000_000n);
    service.tradeStatus.mockResolvedValue({ status: "confirmed" });
    const id = idOf(request.authorization);
    await status.GET(new Request(`${SITE}/api/v1/trade/${id}`), {
      params: Promise.resolve({ id }),
    });
    expect((await reservationOf(db, id))?.status).toBe("confirmed");
    expect(await usedOn(db, taker, day)).toBe(1_000_000n);
  });

  it("a failed trade releases its reservation", async () => {
    const taker = fresh();
    service.submitSignedTrade.mockResolvedValue({ status: "failed" });
    expect(
      (await submit.POST(post("/api/v1/trade/submit", body(taker)))).status,
    ).toBe(200);
    expect(await usedOn(db, taker, utcDay(new Date()))).toBe(0n);
  });

  it("a submit that throws before anything was sent releases; one that may have been sent keeps", async () => {
    const taker = fresh();
    service.submitSignedTrade.mockRejectedValue(new Error("boom"));
    outcome = "failed";
    await submit.POST(post("/api/v1/trade/submit", body(taker)));
    expect(await usedOn(db, taker, utcDay(new Date()))).toBe(0n);
    outcome = "open";
    await submit.POST(post("/api/v1/trade/submit", body(taker)));
    expect(await usedOn(db, taker, utcDay(new Date()))).toBe(1_000_000n);
  });

  it("at the edge of the day: parallel submits never pass the cap", async () => {
    setCapsDepsForTests({
      env: () => ({
        AROMA_MAX_TRADE_USDC_RAW: "1000000",
        AROMA_MAX_DAILY_USDC_RAW: "3000000",
      }),
      db: () => db,
      price: async () => null,
      outcome: async () => "open",
    });
    const taker = fresh();
    service.submitSignedTrade.mockResolvedValue({ status: "pending" });
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        submit.POST(post("/api/v1/trade/submit", body(taker))),
      ),
    );
    const codes = await Promise.all(
      responses.map(async (r) =>
        r.status === 202 ? "ok" : (await r.json()).code,
      ),
    );
    expect(codes.filter((c) => c === "ok")).toHaveLength(3);
    expect(codes.filter((c) => c === "DAILY_CAP_EXCEEDED")).toHaveLength(5);
    expect(await usedOn(db, taker, utcDay(new Date()))).toBe(3_000_000n);
    expect(service.submitSignedTrade).toHaveBeenCalledTimes(3);
  });

  it("the database being unavailable fails closed before anything is sent", async () => {
    dbDown = true;
    const response = await submit.POST(
      post("/api/v1/trade/submit", body(fresh())),
    );
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("TRADE_CAP_UNAVAILABLE");
    expect(service.submitSignedTrade).not.toHaveBeenCalled();
  });
});

describe("Solana Action", () => {
  it("reserves the quoted amount and keeps it for the day (the Blink sends it itself)", async () => {
    const requestId = crypto.randomUUID();
    service.quoteTrade.mockResolvedValue({
      ...prepared("40000000", requestId),
      quote: {
        inputMint: USDC_MINT,
        maxDebit: "40000000",
        kind: "basket",
        legs: [],
      },
    });
    const account = fresh();
    await action.POST(
      post("/api/v1/actions/baskets/test-basket?amount=40", { account }),
      {
        params: Promise.resolve({ id: "test-basket" }),
      },
    );
    expect((await reservationOf(db, requestId))?.status).toBe("confirmed");
    expect(await usedOn(db, account, utcDay(new Date()))).toBe(40_000_000n);
  });
});
