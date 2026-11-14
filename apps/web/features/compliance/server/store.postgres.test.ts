import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb } from "@/features/creators/test/db";
import type { Database } from "@/server/db/client";
import { dbTermsStore } from "./store";

/** Migration 0004 on a real Postgres (PGlite): idempotent per wallet+version+hash, single-use nonce. */
let client: PGlite;
let store: ReturnType<typeof dbTermsStore>;
const WALLET = "4Nd1mYQzvgp7uVDYiHn9wrpTkMtZpZyV9pR9ZJ2q5vPz";
const HASH = "a".repeat(64);
const row = (nonce: string, overrides = {}) => ({
  wallet: WALLET,
  termsVersion: "v1",
  termsHash: HASH,
  message: "signed text",
  signature: "c2ln",
  nonce,
  country: "DE",
  ...overrides,
});

beforeAll(async () => {
  const test = await createTestDb();
  client = test.client;
  store = dbTermsStore(test.db as unknown as Database);
});
afterAll(async () => client.close());

describe("terms_acceptances (0004)", () => {
  it("stores and finds an acceptance for exactly that wallet, version and hash", async () => {
    expect(await store.accepted(WALLET, "v1", HASH)).toBe(false);
    await store.insert(row("n".repeat(32)));
    expect(await store.accepted(WALLET, "v1", HASH)).toBe(true);
    expect(await store.accepted(WALLET, "v2", HASH)).toBe(false);
    expect(await store.accepted(WALLET, "v1", "b".repeat(64))).toBe(false);
  });

  it("a second acceptance of the same version is a no-op", async () => {
    await store.insert(row("m".repeat(32)));
    const { rows } = await client.query(
      "SELECT count(*)::int AS n FROM terms_acceptances",
    );
    expect(rows[0]).toEqual({ n: 1 });
  });

  it("a nonce is unique across rows, and the CHECKs refuse bad hashes and countries", async () => {
    await expect(
      store.insert(row("n".repeat(32), { termsVersion: "v2" })),
    ).rejects.toThrow();
    await expect(
      store.insert(
        row("o".repeat(32), { termsVersion: "v3", termsHash: "xyz" }),
      ),
    ).rejects.toThrow();
    await expect(
      store.insert(row("p".repeat(32), { termsVersion: "v4", country: "usa" })),
    ).rejects.toThrow();
  });
});
