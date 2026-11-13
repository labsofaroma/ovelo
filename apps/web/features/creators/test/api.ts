import type { PGlite } from "@electric-sql/pglite";
import { makeSigner, memoryStore } from "@/server/test/creator-fixtures";
import type { LimitDecision } from "@/server/ratelimit";
import type { CreatorsDb } from "../db";
import { type CreatorDeps, setCreatorDepsForTests } from "../http";
import { createInvite } from "../invites";
import type { AssetRegistry } from "../server";
import { createTestDb } from "./db";
import { NOW, registry as defaultRegistry } from "./fixtures";

export const SITE = "https://aroma.test";

/** Route-test harness: PGlite, an in-memory nonce store, a settable clock and limiter. */
export async function apiHarness() {
  const { db, client } = await createTestDb();
  const store = memoryStore();
  const state = {
    now: NOW,
    registry: defaultRegistry as AssetRegistry | Error,
    limit: { allowed: true } as Pick<LimitDecision, "allowed">,
  };
  const deps: CreatorDeps = {
    db: () => db,
    challenges: () => store,
    registry: async () => {
      if (state.registry instanceof Error) throw state.registry;
      return state.registry;
    },
    now: () => state.now,
    limiter: (name, limit) => ({
      name,
      check: async () => ({
        allowed: state.limit.allowed,
        limit,
        remaining: 0,
        retryAfterSeconds: state.limit.allowed ? 0 : 42,
        source: "local",
      }),
    }),
  };
  setCreatorDepsForTests(deps);
  return { db, client, store, state };
}

export function jsonRequest(
  path: string,
  method: "POST" | "DELETE" | "GET",
  body?: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`${SITE}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      origin: SITE,
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export type Signer = Awaited<ReturnType<typeof makeSigner>>;
export { makeSigner };

type Post = (request: Request) => Promise<Response>;

/** Ask the challenge route for a nonce + message, and sign the message with `signer`. */
export async function signedFields(
  challengePost: Post,
  signer: Signer,
  body: Record<string, unknown>,
): Promise<{ nonce: string; signature: string; basketId: string | null }> {
  const response = await challengePost(
    jsonRequest("/api/v1/creators/challenge", "POST", {
      wallet: signer.wallet,
      ...body,
    }),
  );
  if (response.status !== 200)
    throw new Error(
      `challenge failed: ${response.status} ${await response.text()}`,
    );
  const challenge = (await response.json()) as {
    nonce: string;
    message: string;
    basketId: string | null;
  };
  return {
    nonce: challenge.nonce,
    signature: await signer.sign(challenge.message),
    basketId: challenge.basketId,
  };
}

/** Make `signer` a creator directly in the database (invite redemption is tested on its own). */
export async function enrol(db: CreatorsDb, client: PGlite, signer: Signer) {
  const invite = await createInvite(db, {
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    now: NOW,
  });
  await client.query(
    `INSERT INTO creators (wallet, display_name, invite_id) VALUES ($1, 'Creator', $2)`,
    [signer.wallet, invite.id],
  );
}

export async function json(
  response: Response,
): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}
