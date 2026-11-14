import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Applies the real generated migrations (including the custom weights trigger) to an in-process
 * Postgres (PGlite), then probes the constraints. The migrations folder is the source of truth.
 */
const MIGRATIONS = new URL("./migrations/", import.meta.url);
let db: PGlite;

async function migrate(target: PGlite) {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(new URL(file, MIGRATIONS), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) await target.exec(statement);
    }
  }
}

const WALLET = "4Nd1mYQzvgp7uVDYiHn9wrpTkMtZpZyV9pR9ZJ2q5vPz";
const MINT_A = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const MINT_B = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const MINT_C = "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ";

async function violation(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

async function basket(id: string, ticker: string, status = "draft") {
  const published = status === "published" ? ", now()" : ", NULL";
  await db.query(
    `INSERT INTO baskets (id, name, ticker, category, status, published_at) VALUES ($1, 'n', $2, 'c', $3${published})`,
    [id, ticker, status],
  );
}

beforeAll(async () => {
  db = new PGlite();
  await migrate(db);
});
afterAll(async () => {
  await db.close();
});

describe("migrations", () => {
  it("create the eight tables from REWRITE-PLAN §6, plus basket_versions (M5b, 0002)", async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name NOT LIKE '\\_\\_%' ORDER BY 1`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      "basket_allocations",
      "basket_versions",
      "baskets",
      "creators",
      "invites",
      "notifications",
      "plans_index",
      "portfolio_snapshots",
      "receipts",
    ]);
  });
});

describe("basket weights sum to 10,000 bps for published baskets", () => {
  it("accepts a published basket whose allocations sum to exactly 10,000 in one transaction", async () => {
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO baskets (id, name, ticker, category, status, published_at) VALUES ('00000000-0000-0000-0000-0000000000a1', 'ok', 'OK1', 'c', 'published', now())`,
      );
      await tx.query(
        `INSERT INTO basket_allocations VALUES ('00000000-0000-0000-0000-0000000000a1', '${MINT_A}', 'AAA', 6000), ('00000000-0000-0000-0000-0000000000a1', '${MINT_B}', 'BBB', 4000)`,
      );
    });
    const { rows } = await db.query<{ total: string }>(
      `SELECT SUM(weight_bps)::text AS total FROM basket_allocations WHERE basket_id = '00000000-0000-0000-0000-0000000000a1'`,
    );
    expect(rows[0]?.total).toBe("10000");
  });

  it("rejects publishing a basket whose weights sum to 9,999 at COMMIT", async () => {
    const message = await violation(() =>
      db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO baskets (id, name, ticker, category, status, published_at) VALUES ('00000000-0000-0000-0000-0000000000a2', 'bad', 'BAD1', 'c', 'published', now())`,
        );
        await tx.query(
          `INSERT INTO basket_allocations VALUES ('00000000-0000-0000-0000-0000000000a2', '${MINT_A}', 'AAA', 5000), ('00000000-0000-0000-0000-0000000000a2', '${MINT_B}', 'BBB', 4999)`,
        );
      }),
    );
    expect(message).toMatch(/9999 bps, expected 10000/);
  });

  it("rejects publishing a basket with no allocations", async () => {
    const message = await violation(() =>
      db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO baskets (id, name, ticker, category, status, published_at) VALUES ('00000000-0000-0000-0000-0000000000a3', 'empty', 'EMP1', 'c', 'published', now())`,
        );
      }),
    );
    expect(message).toMatch(/0 bps, expected 10000/);
  });

  it("rejects weights over 10,000 in total", async () => {
    const message = await violation(() =>
      db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO baskets (id, name, ticker, category, status, published_at) VALUES ('00000000-0000-0000-0000-0000000000a4', 'over', 'OVR1', 'c', 'published', now())`,
        );
        await tx.query(
          `INSERT INTO basket_allocations VALUES ('00000000-0000-0000-0000-0000000000a4', '${MINT_A}', 'AAA', 6000), ('00000000-0000-0000-0000-0000000000a4', '${MINT_B}', 'BBB', 6000)`,
        );
      }),
    );
    expect(message).toMatch(/12000 bps/);
  });

  it("rejects a later edit that breaks a published basket's sum, and a draft promoted too early", async () => {
    const edit = await violation(() =>
      db.query(
        `UPDATE basket_allocations SET weight_bps = 3999 WHERE basket_id = '00000000-0000-0000-0000-0000000000a1' AND mint = '${MINT_B}'`,
      ),
    );
    expect(edit).toMatch(/9999 bps/);
    const remove = await violation(() =>
      db.query(
        `DELETE FROM basket_allocations WHERE basket_id = '00000000-0000-0000-0000-0000000000a1' AND mint = '${MINT_B}'`,
      ),
    );
    expect(remove).toMatch(/6000 bps/);

    await basket("00000000-0000-0000-0000-0000000000a5", "DRF1");
    await db.query(
      `INSERT INTO basket_allocations VALUES ('00000000-0000-0000-0000-0000000000a5', '${MINT_A}', 'AAA', 3000)`,
    );
    const promote = await violation(() =>
      db.query(
        `UPDATE baskets SET status = 'published', published_at = now() WHERE id = '00000000-0000-0000-0000-0000000000a5'`,
      ),
    );
    expect(promote).toMatch(/3000 bps, expected 10000/);
  });

  it("lets a draft hold partial weights, then publish once complete", async () => {
    const id = "00000000-0000-0000-0000-0000000000a6";
    await basket(id, "DRF2");
    await db.query(
      `INSERT INTO basket_allocations VALUES ('${id}', '${MINT_A}', 'AAA', 2500)`,
    );
    await db.query(
      `INSERT INTO basket_allocations VALUES ('${id}', '${MINT_B}', 'BBB', 7500)`,
    );
    await db.query(
      `UPDATE baskets SET status = 'published', published_at = now() WHERE id = '${id}'`,
    );
    const { rows } = await db.query<{ status: string }>(
      `SELECT status FROM baskets WHERE id = '${id}'`,
    );
    expect(rows[0]?.status).toBe("published");
  });

  it("cascades basket deletion without tripping the trigger", async () => {
    await db.query(
      `DELETE FROM baskets WHERE id = '00000000-0000-0000-0000-0000000000a6'`,
    );
    const { rows } = await db.query(
      `SELECT 1 FROM basket_allocations WHERE basket_id = '00000000-0000-0000-0000-0000000000a6'`,
    );
    expect(rows).toHaveLength(0);
  });
});

describe("unique keys and checks", () => {
  it("baskets.ticker is unique", async () => {
    await basket("00000000-0000-0000-0000-0000000000b1", "UNQ1");
    const message = await violation(() =>
      basket("00000000-0000-0000-0000-0000000000b2", "UNQ1"),
    );
    expect(message).toMatch(/baskets_ticker_unique/);
  });

  it("(basket, mint) is the allocation primary key and (basket, symbol) is unique", async () => {
    const id = "00000000-0000-0000-0000-0000000000b1";
    await db.query(
      `INSERT INTO basket_allocations VALUES ('${id}', '${MINT_A}', 'AAA', 100)`,
    );
    expect(
      await violation(() =>
        db.query(
          `INSERT INTO basket_allocations VALUES ('${id}', '${MINT_A}', 'ZZZ', 100)`,
        ),
      ),
    ).toMatch(/basket_allocations_basket_id_mint_pk/);
    expect(
      await violation(() =>
        db.query(
          `INSERT INTO basket_allocations VALUES ('${id}', '${MINT_C}', 'AAA', 100)`,
        ),
      ),
    ).toMatch(/basket_allocations_basket_symbol_unique/);
  });

  it("weight_bps must be within 1..10000", async () => {
    const id = "00000000-0000-0000-0000-0000000000b1";
    for (const weight of [0, -5, 10001]) {
      expect(
        await violation(() =>
          db.query(
            `INSERT INTO basket_allocations VALUES ('${id}', '${MINT_C}', 'CCC', ${weight})`,
          ),
        ),
      ).toMatch(/basket_allocations_weight_range/);
    }
  });

  it("invites: unique code_hash, positive max_uses, uses never above max_uses", async () => {
    await db.query(
      `INSERT INTO invites (code_hash, max_uses) VALUES ('h1', 1)`,
    );
    expect(
      await violation(() =>
        db.query(`INSERT INTO invites (code_hash) VALUES ('h1')`),
      ),
    ).toMatch(/invites_code_hash_unique/);
    expect(
      await violation(() =>
        db.query(`INSERT INTO invites (code_hash, max_uses) VALUES ('h2', 0)`),
      ),
    ).toMatch(/invites_max_uses_positive/);
    expect(
      await violation(() =>
        db.query(`UPDATE invites SET uses = 2 WHERE code_hash = 'h1'`),
      ),
    ).toMatch(/invites_uses_in_range/);
  });

  it("plans_index: pda is the key and (owner, funding_mint, nonce) is unique", async () => {
    const row = (pda: string, nonce: string) =>
      db.query(
        `INSERT INTO plans_index (pda, owner, funding_mint, nonce) VALUES ('${pda}', '${WALLET}', '${MINT_A}', '${nonce}')`,
      );
    await row("pda1", "1");
    expect(await violation(() => row("pda1", "2"))).toMatch(/plans_index_pkey/);
    expect(await violation(() => row("pda2", "1"))).toMatch(
      /plans_index_owner_funding_nonce_unique/,
    );
  });

  it("baskets with status published need a published_at", async () => {
    expect(
      await violation(() =>
        db.query(
          `INSERT INTO baskets (name, ticker, category, status) VALUES ('x', 'NOP1', 'c', 'published')`,
        ),
      ),
    ).toMatch(/baskets_published_has_timestamp/);
  });

  it("receipts: signature is the key", async () => {
    const insert = () =>
      db.query(
        `INSERT INTO receipts (signature, wallet, kind, amount_in, mint_in) VALUES ('sig1', '${WALLET}', 'spot', '1000000', '${MINT_A}')`,
      );
    await insert();
    expect(await violation(insert)).toMatch(/receipts_pkey/);
  });
});

describe("amounts are bigint-safe text, never floats", () => {
  it("round-trips a u64 above Number.MAX_SAFE_INTEGER exactly", async () => {
    const big = (2n ** 64n - 1n).toString();
    await db.query(
      `INSERT INTO receipts (signature, wallet, kind, amount_in, mint_in, slot) VALUES ('sig-big', '${WALLET}', 'basket', '${big}', '${MINT_A}', 9007199254740993)`,
    );
    const { rows } = await db.query<{ amount_in: string }>(
      `SELECT amount_in FROM receipts WHERE signature = 'sig-big'`,
    );
    expect(rows[0]?.amount_in).toBe(big);
    expect(BigInt(rows[0]?.amount_in ?? "0")).toBe(2n ** 64n - 1n);
  });

  it("rejects decimals, signs, exponents and blanks in amount columns", async () => {
    for (const bad of ["1.5", "-1", "1e6", "", " 1", "0x10"]) {
      expect(
        await violation(() =>
          db.query(
            `INSERT INTO receipts (signature, wallet, kind, amount_in, mint_in) VALUES ('sig-${bad.length}${bad}', '${WALLET}', 'spot', $1, '${MINT_A}')`,
            [bad],
          ),
        ),
        `amount_in=${JSON.stringify(bad)}`,
      ).toMatch(/receipts_amount_in_raw/);
    }
    expect(
      await violation(() =>
        db.query(
          `INSERT INTO plans_index (pda, owner, funding_mint, nonce) VALUES ('pdaX', '${WALLET}', '${MINT_A}', '1.0')`,
        ),
      ),
    ).toMatch(/plans_index_nonce_raw/);
  });

  it("stores value_usd as exact numeric", async () => {
    await db.query(
      `INSERT INTO portfolio_snapshots VALUES ('${WALLET}', '2026-01-01T00:00:00Z', '[]', 0.1)`,
    );
    await db.query(
      `INSERT INTO portfolio_snapshots VALUES ('${WALLET}', '2026-01-02T00:00:00Z', '[]', 0.2)`,
    );
    const { rows } = await db.query<{ sum: string }>(
      `SELECT (SUM(value_usd))::text AS sum FROM portfolio_snapshots`,
    );
    expect(rows[0]?.sum).toBe("0.300000"); // 0.1 + 0.2 in a float would be 0.30000000000000004
  });
});
