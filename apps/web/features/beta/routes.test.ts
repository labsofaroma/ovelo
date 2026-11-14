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
import { setComplianceDepsForTests } from "@/features/compliance/server/deps";
import { memoryTermsStore } from "@/features/compliance/server/store";
import { loadPolicy } from "@/features/compliance/policy";
import { createTestDb } from "@/features/creators/test/db";
import { toMarketsView } from "@/features/markets/normalize";
import { snapshot } from "@/features/test/fixtures";
import { resetEnvCacheForTests } from "@/server/env";
import { makeSigner, memoryStore } from "@/server/test/creator-fixtures";
import { betaConfig } from "./config";
import { setBetaDepsForTests } from "./server/deps";
import { createBetaInvite, type BetaDb } from "./server/invites";
import { authorizationFor } from "./test/fixtures";

/**
 * W2 at route level (real gate, terms and invite code on PGlite; in-memory nonces): with the gate
 * on, quote, submit and the Action POST refuse a wallet without beta access, the Action GET is
 * disabled, redeem is wallet-signed and single-use, and a database failure fails closed.
 */
const service = vi.hoisted(() => ({
  quoteTrade: vi.fn(),
  submitSignedTrade: vi.fn(),
  tradeStatus: vi.fn(),
  publicRecord: (r: unknown) => r,
}));
vi.mock("@/features/trade/server/service", () => service);
vi.mock("@/features/markets/server", () => ({
  getMarkets: async () => ({ state: "ok", data: toMarketsView(snapshot()) }),
}));

const quote = await import("@/app/api/v1/trade/quote/route");
const submit = await import("@/app/api/v1/trade/submit/route");
const action = await import("@/app/api/v1/actions/baskets/[id]/route");
const status = await import("@/app/api/v1/beta/status/route");
const challenge = await import("@/app/api/v1/beta/challenge/route");
const redeem = await import("@/app/api/v1/beta/redeem/route");
const termsChallenge =
  await import("@/app/api/v1/compliance/terms/challenge/route");
const termsAccept = await import("@/app/api/v1/compliance/terms/accept/route");

const SITE = "https://aroma.example";
const DE = { "x-vercel-ip-country": "DE" };
const US = { "x-vercel-ip-country": "US" };
const json = (
  path: string,
  body: unknown,
  headers: Record<string, string> = DE,
) =>
  new Request(`${SITE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const quoteBody = (taker: string) => ({
  target: { kind: "spot", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp" },
  inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  amount: "10",
  taker,
  supportedTransactionVersions: [0],
});

let db: BetaDb;
let client: PGlite;
let dbDown = false;
beforeAll(async () => {
  ({ db, client } = await createTestDb());
});
afterAll(async () => client.close());

beforeEach(() => {
  vi.stubEnv("AROMA_V1_ENABLED", "true");
  vi.stubEnv("AROMA_SITE_URL", SITE);
  vi.stubEnv("AROMA_TRUST_PROXY", "true");
  vi.stubEnv("AROMA_BETA_GATE", "on");
  vi.stubEnv("AROMA_TRADE_SECRET", "s".repeat(40));
  // The rest of the v1-required set, so the validated env (and the trade keyring) loads.
  vi.stubEnv("SOLANA_RPC_URL", "https://rpc.example.test");
  vi.stubEnv("DATABASE_URL", "postgres://u:p@db.example.test/aroma");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example.test");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
  resetEnvCacheForTests();
  dbDown = false;
  const terms = memoryTermsStore();
  const termsChallenges = memoryStore();
  setComplianceDepsForTests({
    store: () => terms,
    challenges: () => termsChallenges,
    policy: () => loadPolicy(process.env),
  });
  const challenges = memoryStore();
  setBetaDepsForTests({
    config: () => betaConfig(process.env),
    db: () => {
      if (dbDown) throw new Error("connection refused");
      return db;
    },
    challenges: () => challenges,
  });
  service.quoteTrade.mockReset();
  service.quoteTrade.mockResolvedValue({
    requestId: "r",
    transactions: ["AA"],
  });
  service.submitSignedTrade.mockReset();
  service.submitSignedTrade.mockResolvedValue({ status: "pending" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCacheForTests();
  setComplianceDepsForTests({});
  setBetaDepsForTests({});
});

type Signer = Awaited<ReturnType<typeof makeSigner>>;

async function redeemWith(signer: Signer, code: string, headers = DE) {
  const issued = await challenge.POST(
    json("/api/v1/beta/challenge", { wallet: signer.wallet, code }, headers),
  );
  expect(issued.status).toBe(200);
  const { nonce, message } = (await issued.json()) as {
    nonce: string;
    message: string;
  };
  const body = {
    wallet: signer.wallet,
    code,
    nonce,
    signature: await signer.sign(message),
  };
  return {
    body,
    response: await redeem.POST(json("/api/v1/beta/redeem", body, headers)),
  };
}

async function acceptTerms(signer: Signer) {
  const issued = await termsChallenge.POST(
    json("/api/v1/compliance/terms/challenge", { wallet: signer.wallet }),
  );
  const { nonce, message, version } = (await issued.json()) as Record<
    string,
    string
  >;
  await termsAccept.POST(
    json("/api/v1/compliance/terms/accept", {
      wallet: signer.wallet,
      nonce,
      signature: await signer.sign(message!),
      version,
    }),
  );
}

const newInvite = async (maxUses = 1) =>
  (
    await createBetaInvite(db, {
      expiresAt: new Date(Date.now() + 86_400_000),
      maxUses,
    })
  ).code;

describe("quote with the gate on", () => {
  it("no access → 403 BETA_ACCESS_REQUIRED before terms; redeem → terms → quoted", async () => {
    const signer = await makeSigner();
    const refused = await quote.POST(
      json("/api/v1/trade/quote", quoteBody(signer.wallet)),
    );
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({
      code: "BETA_ACCESS_REQUIRED",
      message: expect.stringMatching(/private beta/),
    });
    const { response } = await redeemWith(signer, await newInvite());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      access: true,
      alreadyHadAccess: false,
    });
    // Order: location → beta → terms. With access but no terms, TERMS_REQUIRED.
    const terms = await quote.POST(
      json("/api/v1/trade/quote", quoteBody(signer.wallet)),
    );
    expect((await terms.json()).code).toBe("TERMS_REQUIRED");
    await acceptTerms(signer);
    const ok = await quote.POST(
      json("/api/v1/trade/quote", quoteBody(signer.wallet)),
    );
    expect(ok.status).toBe(200);
    expect(service.quoteTrade).toHaveBeenCalledOnce();
  });

  it("location comes first: a blocked country gets 451, not a beta refusal", async () => {
    const signer = await makeSigner();
    const response = await quote.POST(
      json("/api/v1/trade/quote", quoteBody(signer.wallet), US),
    );
    expect(response.status).toBe(451);
  });

  it("an allowlisted wallet needs no invite", async () => {
    const signer = await makeSigner();
    vi.stubEnv("AROMA_BETA_WALLETS", signer.wallet);
    await acceptTerms(signer);
    expect(
      (await quote.POST(json("/api/v1/trade/quote", quoteBody(signer.wallet))))
        .status,
    ).toBe(200);
  });

  it("the database being unavailable fails closed (503), nothing quoted", async () => {
    const signer = await makeSigner();
    dbDown = true;
    const response = await quote.POST(
      json("/api/v1/trade/quote", quoteBody(signer.wallet)),
    );
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("BETA_ACCESS_UNAVAILABLE");
    expect(service.quoteTrade).not.toHaveBeenCalled();
  });

  it("the gate off lets every allowed wallet through (Phase B)", async () => {
    vi.stubEnv("AROMA_BETA_GATE", "off");
    const signer = await makeSigner();
    await acceptTerms(signer);
    expect(
      (await quote.POST(json("/api/v1/trade/quote", quoteBody(signer.wallet))))
        .status,
    ).toBe(200);
  });
});

describe("submit with the gate on", () => {
  it("refuses the wallet named by the verified authorization; accepts it after redeeming", async () => {
    const signer = await makeSigner();
    const body = {
      authorization: authorizationFor(signer.wallet),
      signedTransactions: ["AAAA"],
    };
    const refused = await submit.POST(json("/api/v1/trade/submit", body));
    expect(refused.status).toBe(403);
    expect((await refused.json()).code).toBe("BETA_ACCESS_REQUIRED");
    expect(service.submitSignedTrade).not.toHaveBeenCalled();
    await redeemWith(signer, await newInvite());
    expect((await submit.POST(json("/api/v1/trade/submit", body))).status).toBe(
      202,
    );
  });

  it("a forged authorization is refused before any beta lookup", async () => {
    const response = await submit.POST(
      json("/api/v1/trade/submit", {
        authorization: "at1.x.y.z",
        signedTransactions: ["AAAA"],
      }),
    );
    expect((await response.json()).code).toBe("AUTHORIZATION_INVALID");
  });
});

describe("redeem", () => {
  it("a used code is refused, also for the wallet that used it; a replayed signature too", async () => {
    const signer = await makeSigner();
    const code = await newInvite();
    const first = await redeemWith(signer, code);
    expect(first.response.status).toBe(200);
    const replay = await redeem.POST(json("/api/v1/beta/redeem", first.body));
    expect(replay.status).toBe(401);
    const again = await redeemWith(signer, code);
    expect(again.response.status).toBe(403);
    expect((await again.response.json()).code).toBe("BETA_INVITE_INVALID");
    const other = await redeemWith(await makeSigner(), code);
    expect((await other.response.json()).code).toBe("BETA_INVITE_INVALID");
  });

  it("a signature for one code cannot redeem another, and another wallet cannot use it", async () => {
    const signer = await makeSigner();
    const issued = await challenge.POST(
      json("/api/v1/beta/challenge", {
        wallet: signer.wallet,
        code: await newInvite(),
      }),
    );
    const { nonce, message } = (await issued.json()) as {
      nonce: string;
      message: string;
    };
    const swapped = await redeem.POST(
      json("/api/v1/beta/redeem", {
        wallet: signer.wallet,
        code: await newInvite(),
        nonce,
        signature: await signer.sign(message),
      }),
    );
    expect(swapped.status).toBe(401);
  });

  it("a restricted location cannot burn an invite", async () => {
    const signer = await makeSigner();
    const code = await newInvite();
    const response = await redeem.POST(
      json(
        "/api/v1/beta/redeem",
        {
          wallet: signer.wallet,
          code,
          nonce: "n".repeat(32),
          signature: "c2ln",
        },
        US,
      ),
    );
    expect(response.status).toBe(451);
    expect((await redeemWith(signer, code)).response.status).toBe(200);
  });

  it("status reports the gate and a wallet's access", async () => {
    const signer = await makeSigner();
    const read = async (q = "") =>
      (await status.GET(new Request(`${SITE}/api/v1/beta/status${q}`))).json();
    expect(await read()).toEqual({ gate: true, access: null });
    expect(await read(`?wallet=${signer.wallet}`)).toEqual({
      gate: true,
      access: false,
    });
    await redeemWith(signer, await newInvite());
    expect(await read(`?wallet=${signer.wallet}`)).toEqual({
      gate: true,
      access: true,
    });
  });
});

describe("Solana Action with the gate on", () => {
  it("GET is disabled with where to go; POST refuses a wallet without access", async () => {
    const meta = await (
      await action.GET(
        new Request(`${SITE}/api/v1/actions/baskets/test-basket`, {
          headers: DE,
        }),
        params("test-basket"),
      )
    ).json();
    expect(meta.disabled).toBe(true);
    expect(meta.error.message).toMatch(/private beta/);
    expect(meta.error.message).toContain(`${SITE}/v1/basket/test-basket`);
    const signer = await makeSigner();
    const refused = await action.POST(
      json("/api/v1/actions/baskets/test-basket?amount=2", {
        account: signer.wallet,
      }),
      params("test-basket"),
    );
    expect(refused.status).toBe(403);
    const body = await refused.json();
    expect(body.code).toBe("BETA_ACCESS_REQUIRED");
    expect(body.message).toContain(`${SITE}/v1/basket/test-basket`);
    expect(service.quoteTrade).not.toHaveBeenCalled();
  });
});
