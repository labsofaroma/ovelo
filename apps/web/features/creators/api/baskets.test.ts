import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { GET as stats } from "@/app/api/v1/creators/[wallet]/stats/route";
import {
  DELETE as archive,
  GET as read,
} from "@/app/api/v1/creators/baskets/[id]/route";
import { POST as baskets } from "@/app/api/v1/creators/baskets/route";
import { POST as challenge } from "@/app/api/v1/creators/challenge/route";
import { CHALLENGE_TTL_SECONDS } from "@/server/auth/creator";
import { AppError } from "@/server/errors";
import type { BasketDraft } from "../schema";
import {
  apiHarness,
  enrol,
  json,
  jsonRequest,
  makeSigner,
  type Signer,
  signedFields,
} from "../test/api";
import { content, MINT_A, MINT_B, NOW } from "../test/fixtures";

let h: Awaited<ReturnType<typeof apiHarness>>;
let creator: Signer;
let other: Signer;

beforeAll(async () => {
  h = await apiHarness();
  creator = await makeSigner();
  other = await makeSigner();
  await enrol(h.db, h.client, creator);
  await enrol(h.db, h.client, other);
});
afterAll(async () => {
  await h.client.close();
});
beforeEach(() => {
  vi.stubEnv("AROMA_V1_ENABLED", "true");
  h.state.now = NOW;
  h.state.registry = new Map([
    [MINT_A, { symbol: "AAPLx" }],
    [MINT_B, { symbol: "NVDAx" }],
    ["Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ", { symbol: "TSLAx" }],
  ]);
});

const params = <T>(value: T) => ({ params: Promise.resolve(value) });

/** Sign and send a save/publish. `tamper` changes the body after signing. */
async function submit(
  who: Signer,
  action: "publish" | "save",
  basket: BasketDraft,
  options: { basketId?: string; tamper?: Record<string, unknown> } = {},
) {
  const purpose = action === "publish" ? "publish" : "update";
  const fields = await signedFields(challenge, who, {
    purpose,
    basket,
    ...(options.basketId ? { basketId: options.basketId } : {}),
  });
  const body = {
    action,
    wallet: who.wallet,
    basketId: fields.basketId,
    basket,
    nonce: fields.nonce,
    signature: fields.signature,
    ...options.tamper,
  };
  const send = () =>
    baskets(jsonRequest("/api/v1/creators/baskets", "POST", body));
  return { response: await send(), send, basketId: fields.basketId! };
}

async function archiveAs(
  who: Signer,
  id: string,
  overrides: Record<string, unknown> = {},
) {
  const fields = await signedFields(challenge, who, {
    purpose: "delete",
    basketId: id,
  });
  const send = () =>
    archive(
      jsonRequest(`/api/v1/creators/baskets/${id}`, "DELETE", {
        wallet: who.wallet,
        nonce: fields.nonce,
        signature: fields.signature,
        ...overrides,
      }),
      params({ id }),
    );
  return { response: await send(), send };
}

describe("POST /api/v1/creators/baskets", () => {
  it("publishes (201), is readable publicly, and a new version bumps the version", async () => {
    const basket = content();
    const first = await submit(creator, "publish", basket);
    expect(first.response.status).toBe(201);
    const published = (await json(first.response)).basket as {
      version: number;
      ticker: string;
    };
    expect(published).toMatchObject({ status: "published", version: 1 });

    const got = await read(
      jsonRequest(`/api/v1/creators/baskets/${first.basketId}`, "GET"),
      params({ id: first.basketId }),
    );
    expect(got.status).toBe(200);
    expect(((await json(got)).basket as { id: string }).id).toBe(
      first.basketId,
    );

    const next = await submit(
      creator,
      "publish",
      content({
        ticker: published.ticker,
        allocations: [
          { mint: MINT_A, weightBps: 6000 },
          { mint: MINT_B, weightBps: 4000 },
        ],
      }),
      { basketId: first.basketId },
    );
    expect(next.response.status).toBe(201);
    expect(
      ((await json(next.response)).basket as { version: number }).version,
    ).toBe(2);
  });

  it("saves a private draft (200) that is not publicly readable", async () => {
    const draft = {
      ...content(),
      allocations: [{ mint: MINT_A, weightBps: 2500 }],
    };
    const saved = await submit(creator, "save", draft);
    expect(saved.response.status).toBe(200);
    const got = await read(
      jsonRequest(`/api/v1/creators/baskets/${saved.basketId}`, "GET"),
      params({ id: saved.basketId }),
    );
    expect(got.status).toBe(404);
  });

  it("refuses a replay of a signed publish", async () => {
    const attempt = await submit(creator, "publish", content());
    expect(attempt.response.status).toBe(201);
    expect((await attempt.send()).status).toBe(401);
  });

  it("refuses an expired approval", async () => {
    const basket = content();
    const fields = await signedFields(challenge, creator, {
      purpose: "publish",
      basket,
    });
    h.state.now = new Date(NOW.getTime() + CHALLENGE_TTL_SECONDS * 1000 + 1);
    const response = await baskets(
      jsonRequest("/api/v1/creators/baskets", "POST", {
        action: "publish",
        wallet: creator.wallet,
        basket,
        ...fields,
      }),
    );
    expect(response.status).toBe(401);
  });

  it("refuses content changed after signing, and a signature used for another action", async () => {
    const basket = content();
    const changed = await submit(creator, "publish", basket, {
      tamper: { basket: { ...basket, name: "Something else" } },
    });
    expect(changed.response.status).toBe(401);
    // A "save" approval (purpose update) cannot publish.
    const draftSigned = await submit(creator, "save", basket, {
      tamper: { action: "publish" },
    });
    expect(draftSigned.response.status).toBe(401);
  });

  it("refuses wallets that are not creators (403) and baskets owned by someone else (403)", async () => {
    const outsider = await makeSigner();
    const notCreator = await submit(outsider, "publish", content());
    expect(notCreator.response.status).toBe(403);

    const mine = await submit(creator, "publish", content());
    const theirs = await submit(other, "publish", content(), {
      basketId: mine.basketId,
    });
    expect(theirs.response.status).toBe(403);
    expect((await json(theirs.response)).code).toBe("FORBIDDEN");
  });

  it("refuses invalid weights (400) before any signature is checked", async () => {
    const response = await baskets(
      jsonRequest("/api/v1/creators/baskets", "POST", {
        action: "publish",
        wallet: creator.wallet,
        basketId: crypto.randomUUID(),
        basket: content({
          allocations: [
            { mint: MINT_A, weightBps: 5000.5 },
            { mint: MINT_B, weightBps: 4999.5 },
          ],
        }),
        nonce: "x",
        signature: "y",
      }),
    );
    expect(response.status).toBe(400);
    expect((await json(response)).code).toBe("VALIDATION_FAILED");
  });

  it("refuses unregistered assets (400) and reports an unavailable asset list (502)", async () => {
    h.state.registry = new Map([[MINT_A, { symbol: "AAPLx" }]]);
    const unregistered = await submit(creator, "publish", content());
    expect(unregistered.response.status).toBe(400);
    h.state.registry = new AppError("UPSTREAM_UNAVAILABLE");
    const outage = await submit(creator, "publish", content());
    expect(outage.response.status).toBe(502);
  });

  it("maps a taken ticker to 409", async () => {
    const basket = content();
    expect((await submit(creator, "publish", basket)).response.status).toBe(
      201,
    );
    const clash = await submit(other, "publish", { ...basket });
    expect(clash.response.status).toBe(409);
  });

  it("is 404 when the flag is off", async () => {
    vi.stubEnv("AROMA_V1_ENABLED", "false");
    const response = await baskets(
      jsonRequest("/api/v1/creators/baskets", "POST", {}),
    );
    expect(response.status).toBe(404);
  });
});

describe("GET and DELETE /api/v1/creators/baskets/:id", () => {
  it("archives for the owner (never deletes); archived stays readable", async () => {
    const { basketId } = await submit(creator, "publish", content());
    const archived = await archiveAs(creator, basketId);
    expect(archived.response.status).toBe(200);
    expect(
      ((await json(archived.response)).basket as { status: string }).status,
    ).toBe("archived");
    const got = await read(
      jsonRequest(`/api/v1/creators/baskets/${basketId}`, "GET"),
      params({ id: basketId }),
    );
    expect(((await json(got)).basket as { status: string }).status).toBe(
      "archived",
    );
    expect((await archived.send()).status).toBe(401); // replay
  });

  it("refuses another creator (403), a forged wallet claim (401) and an expired approval (401)", async () => {
    const { basketId } = await submit(creator, "publish", content());
    expect((await archiveAs(other, basketId)).response.status).toBe(403);
    expect(
      (await archiveAs(other, basketId, { wallet: creator.wallet })).response
        .status,
    ).toBe(401);
    const fields = await signedFields(challenge, creator, {
      purpose: "delete",
      basketId,
    });
    h.state.now = new Date(NOW.getTime() + CHALLENGE_TTL_SECONDS * 1000);
    const late = await archive(
      jsonRequest(`/api/v1/creators/baskets/${basketId}`, "DELETE", {
        wallet: creator.wallet,
        nonce: fields.nonce,
        signature: fields.signature,
      }),
      params({ id: basketId }),
    );
    expect(late.status).toBe(401);
  });

  it("404s unknown and malformed ids, and everything when the flag is off", async () => {
    for (const id of [crypto.randomUUID(), "not-a-uuid"]) {
      const response = await read(
        jsonRequest(`/api/v1/creators/baskets/${id}`, "GET"),
        params({ id }),
      );
      expect(response.status).toBe(404);
    }
    vi.stubEnv("AROMA_V1_ENABLED", "false");
    const id = crypto.randomUUID();
    expect(
      (
        await read(
          jsonRequest(`/api/v1/creators/baskets/${id}`, "GET"),
          params({ id }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await archive(
          jsonRequest(`/api/v1/creators/baskets/${id}`, "DELETE", {}),
          params({ id }),
        )
      ).status,
    ).toBe(404);
  });
});

describe("GET /api/v1/creators/:wallet/stats", () => {
  it("reports recorded facts with source and as-of, and usage as unavailable", async () => {
    await submit(creator, "publish", content());
    const response = await stats(
      jsonRequest(`/api/v1/creators/${creator.wallet}/stats`, "GET"),
      params({ wallet: creator.wallet }),
    );
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body).toMatchObject({
      wallet: creator.wallet,
      asOf: NOW.toISOString(),
      source: "Aroma creator registry (Postgres)",
      usage: { state: "unavailable" },
    });
    expect((body.baskets as { published: number }).published).toBeGreaterThan(
      0,
    );
    expect(JSON.stringify(body.usage)).not.toMatch(/"(buyers|volume)/);
  });

  it("404s non-creators, malformed wallets and the disabled flag", async () => {
    const outsider = await makeSigner();
    for (const wallet of [outsider.wallet, "nope"]) {
      const response = await stats(
        jsonRequest(`/api/v1/creators/${wallet}/stats`, "GET"),
        params({ wallet }),
      );
      expect(response.status).toBe(404);
    }
    vi.stubEnv("AROMA_V1_ENABLED", "false");
    const response = await stats(
      jsonRequest(`/api/v1/creators/${creator.wallet}/stats`, "GET"),
      params({ wallet: creator.wallet }),
    );
    expect(response.status).toBe(404);
  });
});
