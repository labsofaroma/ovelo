import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/server/env";
import { resetRedisForTests } from "@/server/redis";
import { GENESIS_HASHES } from "@/server/rpc";
import { fingerprint, redactIdentifiers, tradeEvent } from "@/server/telemetry";
import { toMarketsView } from "../../markets/normalize";
import { mint, snapshot } from "../../test/fixtures";

/** Production wiring (deps.ts), the service layer and trade telemetry. */
const markets = vi.hoisted(() => ({ getMarkets: vi.fn() }));
vi.mock("@/features/markets/server", () => markets);

const deps = await import("./deps");
const service = await import("./service");

const SECRET = "wiring-test-trade-secret-at-least-32-characters";
beforeEach(() => {
  vi.stubEnv("AROMA_TRADE_SECRET", SECRET);
  resetEnvCacheForTests();
  resetRedisForTests();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCacheForTests();
  resetRedisForTests();
});

describe("mintDecimals", () => {
  const account = (owner: string, decimals: number, initialized = 1) => {
    const data = Buffer.alloc(82);
    data[44] = decimals;
    data[45] = initialized;
    return {
      value: {
        owner,
        executable: false,
        lamports: 1,
        data: [data.toString("base64"), "base64"],
      },
    };
  };
  it("reads precision from the mint account and caches it", async () => {
    let reads = 0;
    const read = deps.mintDecimals(async <T>() => {
      reads++;
      return account("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", 8) as T;
    });
    expect(await read(mint(41))).toBe(8);
    expect(await read(mint(41))).toBe(8);
    expect(reads).toBe(1);
  });
  it("refuses a missing, foreign-owned or uninitialized mint", async () => {
    for (const value of [
      { value: null },
      account("11111111111111111111111111111111", 6),
      account("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", 6, 0),
    ]) {
      const read = deps.mintDecimals(async <T>() => value as T);
      await expect(read(mint(42 + Math.random()))).rejects.toMatchObject({
        code: "ASSET_UNAVAILABLE",
      });
    }
  });
});

describe("deps", () => {
  it("submit needs Redis outside a local fork (never silently non-idempotent)", () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("SOLANA_RPC_URL", "https://rpc.example.test");
    resetEnvCacheForTests();
    expect(() => deps.submitDeps()).toThrowError(
      expect.objectContaining({ code: "TRADING_UNAVAILABLE" }),
    );
  });
  it("a local-fork E2E run uses in-process stores", async () => {
    vi.stubEnv("SOLANA_RPC_URL", "http://127.0.0.1:8899");
    vi.stubEnv("AROMA_V1_TEST_FORK_GENESIS", GENESIS_HASHES.devnet);
    const wired = deps.submitDeps();
    expect(await wired.store.get("nothing")).toBeNull();
    expect(wired.jito).toBeNull();
  });
  it("quote deps refuse bundles without Jito and need the trade secret", async () => {
    const wired = deps.quoteDeps();
    expect(wired.bundlesEnabled).toBe(false);
    await expect(wired.jitoTip(mint(1))).rejects.toMatchObject({
      code: "BUNDLE_UNAVAILABLE",
    });
    vi.stubEnv("AROMA_TRADE_SECRET", "");
    resetEnvCacheForTests();
    expect(() => deps.quoteDeps()).toThrowError(
      expect.objectContaining({ code: "TRADING_UNAVAILABLE" }),
    );
  });
});

describe("service", () => {
  it("refuses to quote while the issuer catalog is unavailable", async () => {
    markets.getMarkets.mockResolvedValue({ state: "unavailable", error: {} });
    await expect(
      service.quoteTrade({
        target: { kind: "spot", mint: mint(1) },
        inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amount: "1",
        taker: mint(5),
        slippageBps: 100,
        supportedTransactionVersions: [0],
      }),
    ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });
  it("resolves the target before any routing (an unknown asset never reaches Jupiter)", async () => {
    markets.getMarkets.mockResolvedValue({
      state: "ok",
      data: toMarketsView(snapshot()),
    });
    await expect(
      service.quoteTrade({
        target: { kind: "spot", mint: mint(99) },
        inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amount: "1",
        taker: mint(5),
        slippageBps: 100,
        supportedTransactionVersions: [0],
      }),
    ).rejects.toMatchObject({ code: "ASSET_UNAVAILABLE" });
  });
  it("publicRecord exposes status fields only, never the receipt or taker", () => {
    const shown = service.publicRecord({
      id: "i",
      taker: mint(5),
      mode: "single",
      transactionVersion: 0,
      signatures: ["s"],
      bundleId: null,
      status: "pending",
      lastValidBlockHeight: 1,
      receipt: {} as never,
      submittedAt: "t",
      updatedAt: "t",
      slot: null,
      error: null,
    });
    expect(Object.keys(shown)).not.toContain("taker");
    expect(Object.keys(shown)).not.toContain("receipt");
  });
});

describe("telemetry", () => {
  it("replaces wallets and signatures with stable fingerprints", () => {
    const wallet = mint(5);
    const out = redactIdentifiers({
      taker: wallet,
      signatures: [wallet, "x"],
      n: 2,
    });
    expect(out.taker).toBe(fingerprint(wallet));
    expect(JSON.stringify(out)).not.toContain(wallet);
    expect(out.signatures).toEqual([fingerprint(wallet), "x"]);
    expect(() =>
      tradeEvent("test", { taker: wallet }, "warning"),
    ).not.toThrow();
    expect(() => tradeEvent("test", {}, "error")).not.toThrow();
  });
});
