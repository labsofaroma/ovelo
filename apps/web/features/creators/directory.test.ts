import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppError } from "@/server/errors";
import { creators } from "@/server/db/schema";
import type { CreatorsDb } from "./db";
import { publishBasket } from "./server";
import { createTestDb } from "./test/db";
import { ALICE, content, newId, NOW, registry } from "./test/fixtures";

const db = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/server/db/client", () => ({
  getDb: () => {
    if (!db.current)
      throw new AppError("SERVICE_UNAVAILABLE", {
        detail: "DATABASE_URL is not configured",
      });
    return db.current;
  },
}));

const { getDirectory } = await import("./directory");

let handle: { db: CreatorsDb; client: PGlite };
beforeAll(async () => {
  handle = await createTestDb();
});
afterAll(async () => {
  await handle.client.close();
});

describe("creator directory", () => {
  it("is explicitly unavailable (not an empty list) without a database", async () => {
    db.current = null;
    const result = await getDirectory();
    expect(result).toEqual({
      state: "unavailable",
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "This service is temporarily unavailable.",
      },
    });
  });

  it("lists published baskets with source and as-of", async () => {
    db.current = handle.db;
    await handle.db
      .insert(creators)
      .values({ wallet: ALICE, displayName: "Alice" });
    const id = newId();
    await publishBasket(handle.db, {
      wallet: ALICE,
      basketId: id,
      content: content(),
      registry,
      now: NOW,
    });
    const result = await getDirectory({ now: () => NOW });
    expect(result.state).toBe("ok");
    if (result.state !== "ok") return;
    expect(result.data.asOf).toBe(NOW.toISOString());
    expect(result.data.source).toBe("Ovelo creator registry (Postgres)");
    expect(result.data.baskets.map((b) => b.id)).toEqual([id]);
  });
});
