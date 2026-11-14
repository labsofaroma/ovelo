import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SOL_MINT, USDC_MINT, USDT_MINT } from "@/features/trade/schema";
import { AppError } from "@/server/errors";
import { usdcNotional } from "./notional";

const price =
  (raw: string, decimals = 8) =>
  async () => ({ raw, decimals });
const code = async (run: () => Promise<unknown>) => {
  try {
    await run();
    return "ok";
  } catch (error) {
    return error instanceof AppError ? error.code : "other";
  }
};

describe("USDC notional (W3)", () => {
  it("USDC counts 1:1 and never asks for a price", async () => {
    const never = async () => {
      throw new Error("no price call for USDC");
    };
    expect(await usdcNotional(USDC_MINT, 50_000_000n, never)).toBe(50_000_000n);
  });

  it("SOL and USDT are valued in bigint fixed-point, rounded up", async () => {
    // 0.5 SOL at $142.12345678 = $71.06172839 → 71061729 raw USDC (rounded up).
    expect(
      await usdcNotional(SOL_MINT, 500_000_000n, price("14212345678")),
    ).toBe(71_061_729n);
    expect(await usdcNotional(USDT_MINT, 1_000_000n, price("99980000"))).toBe(
      999_800n,
    );
    expect(await usdcNotional(USDT_MINT, 1n, price("1"))).toBe(1n);
  });

  it("no fresh price, a zero price or a failed lookup is refused, never guessed", async () => {
    expect(await code(() => usdcNotional(SOL_MINT, 1n, async () => null))).toBe(
      "TRADE_CAP_UNAVAILABLE",
    );
    expect(await code(() => usdcNotional(SOL_MINT, 1n, price("0")))).toBe(
      "TRADE_CAP_UNAVAILABLE",
    );
    expect(await code(() => usdcNotional(SOL_MINT, 1n, price("-5")))).toBe(
      "TRADE_CAP_UNAVAILABLE",
    );
    expect(
      await code(() =>
        usdcNotional(SOL_MINT, 1n, async () => {
          throw new Error("429");
        }),
      ),
    ).toBe("TRADE_CAP_UNAVAILABLE");
    expect(
      await code(() =>
        usdcNotional(
          "Unknown1111111111111111111111111111111111",
          1n,
          price("1"),
        ),
      ),
    ).toBe("TRADE_CAP_UNAVAILABLE");
  });

  it("never undervalues: notional × 10^(d+p) ≥ amount × price × 10^6 (property, bigint)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: 0n, max: 10n ** 15n }),
        fc.bigInt({ min: 1n, max: 10n ** 13n }),
        async (amount, priceRaw) => {
          const notional = await usdcNotional(
            SOL_MINT,
            amount,
            price(priceRaw.toString()),
          );
          const exact = amount * priceRaw * 10n ** 6n;
          const scale = 10n ** 17n;
          expect(notional * scale >= exact).toBe(true);
          expect((notional - 1n) * scale < exact || notional === 0n).toBe(true);
        },
      ),
    );
  });
});
