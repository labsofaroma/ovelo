import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKeyring } from "@/server/auth/trade";
import { AppError } from "@/server/errors";
import { investHandlers, type InvestServices } from "./routes";
import { memoryInvestStore } from "./store";
import { memoryRedis } from "./test-redis";
import { world } from "./test-world";

const SITE = "http://localhost:3000";
const OWNER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

async function services(
  overrides: Partial<InvestServices> = {},
): Promise<InvestServices> {
  const w = await world();
  return {
    context: async () => ({ network: w.network, rpc: w.chain.rpc }),
    keyring: () => createKeyring("r".repeat(40)),
    store: () => memoryInvestStore(),
    redis: () => memoryRedis(),
    baskets: async () => [],
    faucet: () => ({
      key: new Uint8Array(64),
      turnstileSecret: "x",
      dailyClaims: 1,
    }),
    clientIp: () => "203.0.113.1",
    ...overrides,
  };
}

const post = (path: string, body: unknown, origin = SITE) =>
  new Request(`${SITE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      Host: "localhost:3000",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  const body = (await response.json()) as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(["code", "message"]);
  expect(body.code).toBe(code);
  expect(response.headers.get("cache-control")).toBe("no-store");
}

beforeEach(() => vi.stubEnv("AROMA_V1_ENABLED", "true"));
afterEach(() => vi.unstubAllEnvs());

describe("invest routes", () => {
  it("every route is 404 while v1 is off", async () => {
    vi.stubEnv("AROMA_V1_ENABLED", "false");
    const h = investHandlers(await services());
    await expectError(
      await h.prepareCreate(post("/api/v1/plans/prepare-create", {})),
      404,
      "NOT_FOUND",
    );
    await expectError(
      await h.prepareClose(post("/api/v1/plans/x/prepare-close", {}), OWNER),
      404,
      "NOT_FOUND",
    );
    await expectError(
      await h.submit(post("/api/v1/plans/submit", {})),
      404,
      "NOT_FOUND",
    );
    await expectError(
      await h.faucet(post("/api/v1/faucet", {})),
      404,
      "NOT_FOUND",
    );
    await expectError(
      await h.list(new Request(`${SITE}/api/v1/plans?owner=${OWNER}`)),
      404,
      "NOT_FOUND",
    );
  });

  it("cross-site POSTs are refused before any work", async () => {
    const context = vi.fn();
    const h = investHandlers(await services({ context }));
    await expectError(
      await h.submit(post("/api/v1/plans/submit", {}, "https://evil.example")),
      403,
      "ORIGIN_FORBIDDEN",
    );
    await expectError(
      await h.faucet(post("/api/v1/faucet", {}, "https://evil.example")),
      403,
      "ORIGIN_FORBIDDEN",
    );
    expect(context).not.toHaveBeenCalled();
  });

  it("bodies go through parse(schema): bad JSON, unknown fields and bad addresses are 400", async () => {
    const h = investHandlers(await services());
    await expectError(
      await h.submit(post("/api/v1/plans/submit", "{nope")),
      400,
      "INVALID_JSON",
    );
    await expectError(
      await h.prepareCreate(
        post("/api/v1/plans/prepare-create", { owner: OWNER, extra: 1 }),
      ),
      400,
      "VALIDATION_FAILED",
    );
    await expectError(
      await h.prepareClose(
        post("/api/v1/plans/not-base58/prepare-close", { owner: OWNER }),
        "not-base58!",
      ),
      400,
      "VALIDATION_FAILED",
    );
    await expectError(
      await h.list(new Request(`${SITE}/api/v1/plans?owner=bad`)),
      400,
      "VALIDATION_FAILED",
    );
  });

  it("unavailable on devnet (deployment null) is an honest 503 with a fixed message", async () => {
    const h = investHandlers(
      await services({
        context: async () => {
          throw new AppError("INVEST_UNAVAILABLE", {
            detail: "devnet: not_deployed",
          });
        },
      }),
    );
    const response = await h.list(
      new Request(`${SITE}/api/v1/plans?owner=${OWNER}`),
    );
    await expectError(response.clone(), 503, "INVEST_UNAVAILABLE");
    expect(((await response.json()) as { message: string }).message).toMatch(
      /not available on devnet yet/,
    );
  });

  it("an internal error never leaks its text", async () => {
    const h = investHandlers(
      await services({
        context: async () => {
          throw new Error("redis://user:secret@host exploded");
        },
      }),
    );
    const response = await h.list(
      new Request(`${SITE}/api/v1/plans?owner=${OWNER}`),
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toMatch(/secret|redis/);
  });

  it("lists plans for an owner (empty), with source and as-of", async () => {
    const h = investHandlers(await services());
    const response = await h.list(
      new Request(`${SITE}/api/v1/plans?owner=${OWNER}`),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      cluster: "devnet",
      available: true,
      plans: [],
      source: expect.stringMatching(/Aroma Guard v1/),
    });
  });

  it("prepare-create and prepare-close answer 200 with a transaction; submit and faucet map refusals", async () => {
    const w = await world();
    const h = investHandlers(
      await services({
        context: async () => ({ network: w.network, rpc: w.chain.rpc }),
      }),
    );
    const created = await h.prepareCreate(
      post("/api/v1/plans/prepare-create", {
        owner: w.owner.address,
        fundingAmount: "10000000",
        periodSeconds: 604_800,
        periods: 2,
        selection: {
          kind: "assets",
          outputs: [{ mint: w.aapl.address, weightBps: 10_000 }],
        },
      }),
    );
    expect(created.status).toBe(200);
    const prepared = (await created.json()) as {
      transaction: string;
      authorization: string;
      summary: { label: string };
    };
    expect(prepared.summary.label).toMatch(/Devnet/);
    await expectError(
      await h.prepareClose(
        post("/api/v1/plans/x/prepare-close", { owner: w.owner.address }),
        OWNER,
      ),
      404,
      "NOT_FOUND",
    );
    await expectError(
      await h.submit(
        post("/api/v1/plans/submit", {
          authorization: prepared.authorization,
          transaction: prepared.transaction,
        }),
      ),
      400,
      "SIGNATURE_INVALID",
    );
    await expectError(
      await h.faucet(
        post("/api/v1/faucet", {
          wallet: w.owner.address,
          turnstileToken: "t",
          issuedAt: "1763100000",
          signature: "A".repeat(86) + "==",
        }),
      ),
      401,
      "UNAUTHORIZED",
    );
  });
});
