import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/server/errors";

/**
 * Production wiring of the creator routes (M6 A1): the Upstash challenge store, the market
 * registry, the store choice (Redis vs the local-fork memory store), the DB accessor, overrides,
 * and `creatorRoute`'s gate and error mapping. Every external dependency is mocked; behaviour is
 * unchanged.
 */
const mocks = vi.hoisted(() => ({
  getMarkets: vi.fn(),
  requireRedis: vi.fn(),
  localStores: vi.fn(() => false),
  getDb: vi.fn(() => ({ marker: "db" })),
}));
vi.mock("@/features/markets/server", () => ({ getMarkets: mocks.getMarkets }));
vi.mock("@/server/redis", () => ({ requireRedis: mocks.requireRedis }));
vi.mock("@/features/trade/server/local", () => ({
  localStores: mocks.localStores,
}));
vi.mock("@/server/db/client", () => ({ getDb: mocks.getDb }));

const http = await import("./http");

function fakeRedis() {
  return {
    set: vi.fn(async () => "OK" as const),
    getdel: vi.fn(async () => "payload"),
  };
}

const row = (
  mint: string,
  symbol: string,
  verified = true,
  tradingHalted = false,
) => ({ mint, symbol, verified, tradingHalted });

beforeEach(() => {
  mocks.localStores.mockReturnValue(false);
  http.setCreatorDepsForTests({});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  http.setCreatorDepsForTests({});
});

describe("redisChallengeStore", () => {
  it("writes with NX and the expiry, and consumes with GETDEL", async () => {
    const redis = fakeRedis();
    const store = http.redisChallengeStore(redis as never);
    expect(await store.set("k", "v", { nx: true, ex: 300 })).toBe("OK");
    expect(redis.set).toHaveBeenCalledWith("k", "v", { nx: true, ex: 300 });
    expect(await store.getdel("k")).toBe("payload");
    expect(redis.getdel).toHaveBeenCalledWith("k");
  });
});

describe("creatorDeps defaults", () => {
  it("uses Upstash for challenges outside the local fork", async () => {
    const redis = fakeRedis();
    mocks.requireRedis.mockReturnValue(redis);
    const store = http.creatorDeps().challenges();
    await store.set("a", "b", { nx: true, ex: 60 });
    expect(mocks.requireRedis).toHaveBeenCalledOnce();
    expect(redis.set).toHaveBeenCalledWith("a", "b", { nx: true, ex: 60 });
  });

  it("uses the in-process store on the local fork and never touches Redis", async () => {
    mocks.localStores.mockReturnValue(true);
    const store = http.creatorDeps().challenges();
    expect(await store.set("fork-key", "v", { nx: true, ex: 60 })).toBe("OK");
    expect(await store.getdel("fork-key")).toBe("v");
    expect(mocks.requireRedis).not.toHaveBeenCalled();
  });

  it("propagates a missing Redis as the store's error (fail closed)", () => {
    mocks.requireRedis.mockImplementation(() => {
      throw new AppError("SERVICE_UNAVAILABLE", { detail: "no redis" });
    });
    expect(() => http.creatorDeps().challenges()).toThrow(AppError);
  });

  it("builds the registry from listed, verified, unhalted rows only", async () => {
    mocks.getMarkets.mockResolvedValue({
      state: "fresh",
      data: {
        rows: [
          row("M1", "AAPLx"),
          row("M2", "TSLAx", false),
          row("M3", "NVDAx", true, true),
          row("M4", "SPYx"),
        ],
      },
    });
    const registry = await http.creatorDeps().registry();
    expect([...registry.entries()]).toEqual([
      ["M1", { symbol: "AAPLx" }],
      ["M4", { symbol: "SPYx" }],
    ]);
  });

  it("refuses with UPSTREAM_UNAVAILABLE when the market snapshot is unavailable", async () => {
    mocks.getMarkets.mockResolvedValue({ state: "unavailable" });
    const failure = await http
      .creatorDeps()
      .registry()
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AppError);
    expect((failure as AppError).code).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("returns the shared database client and a live clock", () => {
    expect(http.creatorDeps().db()).toEqual({ marker: "db" });
    const before = Date.now();
    const now = http.creatorDeps().now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
  });

  it("lets tests override single dependencies", () => {
    const fixed = new Date("2026-01-01T00:00:00Z");
    http.setCreatorDepsForTests({ now: () => fixed });
    expect(http.creatorDeps().now()).toBe(fixed);
    expect(http.creatorDeps().db()).toEqual({ marker: "db" });
  });
});

describe("creatorRoute", () => {
  const options = { route: "test", mutation: false };

  it("is 404 when v1 is disabled, without running the handler", async () => {
    vi.stubEnv("AROMA_V1_ENABLED", "false");
    const handler = vi.fn(async () => new Response("ok"));
    const response = await http.creatorRoute(
      options,
      handler,
    )(new Request("http://localhost/api/v1/creators/x"));
    expect(response.status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes the request and context through when v1 is on", async () => {
    vi.stubEnv("AROMA_V1_ENABLED", "true");
    const handler = vi.fn(
      async (_request: Request, context: { id: string }) =>
        new Response(context.id),
    );
    const response = await http.creatorRoute(options, handler)(
      new Request("http://localhost/api/v1/creators/x"),
      { id: "ctx" },
    );
    expect(await response.text()).toBe("ctx");
  });

  it("maps an unreachable database to 503 SERVICE_UNAVAILABLE", async () => {
    vi.stubEnv("AROMA_V1_ENABLED", "true");
    const response = await http.creatorRoute(options, async () => {
      throw Object.assign(new Error("connect ECONNREFUSED"), {
        code: "ECONNREFUSED",
      });
    })(new Request("http://localhost/api/v1/creators/x"));
    expect(response.status).toBe(503);
    const body = (await response.json()) as { code: string; message: string };
    expect(body.code).toBe("SERVICE_UNAVAILABLE");
    expect(body.message).not.toContain("ECONNREFUSED");
  });

  it("never sends an internal error message to the client", async () => {
    vi.stubEnv("AROMA_V1_ENABLED", "true");
    const response = await http.creatorRoute(options, async () => {
      throw new Error("secret internal detail");
    })(new Request("http://localhost/api/v1/creators/x"));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret internal detail");
  });
});
