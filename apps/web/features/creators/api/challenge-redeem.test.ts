import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { POST as challenge } from "@/app/api/v1/creators/challenge/route";
import { POST as redeem } from "@/app/api/v1/creators/invites/redeem/route";
import { CHALLENGE_TTL_SECONDS } from "@/server/auth/creator";
import { createInvite } from "../invites";
import {
  apiHarness,
  json,
  jsonRequest,
  makeSigner,
  type Signer,
  signedFields,
} from "../test/api";
import { content, NOW } from "../test/fixtures";

let h: Awaited<ReturnType<typeof apiHarness>>;
let signer: Signer;
const profile = { displayName: "Ada", social: "https://x.com/ada" };

beforeAll(async () => {
  h = await apiHarness();
  signer = await makeSigner();
});
afterAll(async () => {
  await h.client.close();
});
beforeEach(() => {
  vi.stubEnv("AROMA_V1_ENABLED", "true");
  h.state.now = NOW;
  h.state.limit = { allowed: true };
});

async function newInvite() {
  return createInvite(h.db, {
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    now: NOW,
  });
}

async function redeemAs(who: Signer, code: string) {
  const fields = await signedFields(challenge, who, {
    purpose: "redeem",
    profile,
  });
  return {
    fields,
    send: (overrides: Record<string, unknown> = {}) =>
      redeem(
        jsonRequest("/api/v1/creators/invites/redeem", "POST", {
          wallet: who.wallet,
          code,
          profile,
          nonce: fields.nonce,
          signature: fields.signature,
          ...overrides,
        }),
      ),
  };
}

describe("POST /api/v1/creators/challenge", () => {
  it("returns a nonce, the message to sign and a fresh basket id", async () => {
    const response = await challenge(
      jsonRequest("/api/v1/creators/challenge", "POST", {
        purpose: "publish",
        wallet: signer.wallet,
        basket: content(),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await json(response);
    expect(body.basketId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.nonce).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(body.message).toContain("Aroma: sign to publish a creator basket");
    expect(body.message).toContain("Site: https://aroma.test");
    expect(body.expiresAt).toBe(
      new Date(NOW.getTime() + CHALLENGE_TTL_SECONDS * 1000).toISOString(),
    );
  });

  it("is 404 when AROMA_V1_ENABLED is off", async () => {
    vi.stubEnv("AROMA_V1_ENABLED", "false");
    const response = await challenge(
      jsonRequest("/api/v1/creators/challenge", "POST", {}),
    );
    expect(response.status).toBe(404);
    expect(await json(response)).toEqual({
      code: "NOT_FOUND",
      message: "The resource was not found.",
    });
  });

  it("rejects a cross-origin request and a cross-site fetch", async () => {
    const cases: Record<string, string>[] = [
      { origin: "https://evil.test" },
      { "sec-fetch-site": "cross-site" },
    ];
    for (const headers of cases) {
      const response = await challenge(
        jsonRequest(
          "/api/v1/creators/challenge",
          "POST",
          { purpose: "delete" },
          headers,
        ),
      );
      expect(response.status).toBe(403);
      expect((await json(response)).code).toBe("FORBIDDEN");
    }
  });

  it("validates the body: invalid weights, PDA wallets and unknown purposes are 400", async () => {
    const bodies = [
      {
        purpose: "publish",
        wallet: signer.wallet,
        basket: content({
          allocations: [
            {
              mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
              weightBps: 5000,
            },
            {
              mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
              weightBps: 4000,
            },
          ],
        }),
      },
      {
        purpose: "delete",
        wallet: "not-a-wallet",
        basketId: crypto.randomUUID(),
      },
      { purpose: "mint", wallet: signer.wallet },
    ];
    for (const body of bodies) {
      const response = await challenge(
        jsonRequest("/api/v1/creators/challenge", "POST", body),
      );
      expect(response.status).toBe(400);
      expect(Object.keys(await json(response)).sort()).toEqual([
        "code",
        "message",
      ]);
    }
  });

  it("is rate limited (429 with Retry-After)", async () => {
    h.state.limit = { allowed: false };
    const response = await challenge(
      jsonRequest("/api/v1/creators/challenge", "POST", { purpose: "delete" }),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
  });
});

describe("POST /api/v1/creators/invites/redeem", () => {
  it("redeems a valid invite for the signing wallet (201)", async () => {
    const who = await makeSigner();
    const invite = await newInvite();
    const response = await (await redeemAs(who, invite.code)).send();
    expect(response.status).toBe(201);
    expect(await json(response)).toEqual({
      creator: { wallet: who.wallet, displayName: "Ada" },
    });
  });

  it("refuses a replay of the same signed request", async () => {
    const who = await makeSigner();
    const invite = await newInvite();
    const attempt = await redeemAs(who, invite.code);
    expect((await attempt.send()).status).toBe(201);
    const replay = await attempt.send();
    expect(replay.status).toBe(401);
    expect((await json(replay)).code).toBe("UNAUTHORIZED");
  });

  it("refuses an expired challenge", async () => {
    const who = await makeSigner();
    const attempt = await redeemAs(who, (await newInvite()).code);
    h.state.now = new Date(NOW.getTime() + CHALLENGE_TTL_SECONDS * 1000);
    expect((await attempt.send()).status).toBe(401);
  });

  it("refuses a request signed by another wallet (unauthorized)", async () => {
    const victim = await makeSigner();
    const attacker = await makeSigner();
    const attempt = await redeemAs(attacker, (await newInvite()).code);
    // The attacker claims the victim's wallet with their own signature.
    expect((await attempt.send({ wallet: victim.wallet })).status).toBe(401);
  });

  it("refuses a used invite with 403 and the same message as an unknown one", async () => {
    const invite = await newInvite();
    expect(
      (await (await redeemAs(await makeSigner(), invite.code)).send()).status,
    ).toBe(201);
    const used = await (await redeemAs(await makeSigner(), invite.code)).send();
    const unknown = await (
      await redeemAs(await makeSigner(), "aroma-inv-unknown0000000000000000")
    ).send();
    expect(used.status).toBe(403);
    expect(unknown.status).toBe(403);
    expect(await json(used)).toEqual(await json(unknown));
  });

  it("refuses a changed profile after signing", async () => {
    const who = await makeSigner();
    const attempt = await redeemAs(who, (await newInvite()).code);
    const response = await attempt.send({
      profile: { displayName: "Someone else" },
    });
    expect(response.status).toBe(401);
  });

  it("is 404 when the flag is off", async () => {
    vi.stubEnv("AROMA_V1_ENABLED", "");
    const response = await redeem(
      jsonRequest("/api/v1/creators/invites/redeem", "POST", {}),
    );
    expect(response.status).toBe(404);
  });
});
