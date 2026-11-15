import { describe, expect, it } from "vitest";
import { USDC_MINT } from "../../trade/schema";
import { csvCell, display, portfolioCsv } from "./csv";
import type { PnlView } from "./schema";

describe("CSV", () => {
  it.each([
    ["plain", "plain"],
    ["=HYPERLINK(1)", "'=HYPERLINK(1)"],
    ["-5", "'-5"],
    ["a,b", '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
  ])("escapes %s", (value, expected) => {
    expect(csvCell(value)).toBe(expected);
  });

  it.each([
    ["25000000", 6, "25.000000"],
    ["1", 9, "0.000000001"],
    ["-150", 2, "-1.50"],
    ["7", 0, "7"],
  ])("display(%s, %i) = %s (bigint text, no float)", (raw, decimals, text) => {
    expect(display(raw, decimals)).toBe(text);
  });

  it("orders (mainnet only) and P&L rows, raw and display side by side", () => {
    const pnl: PnlView = {
      method: "average-cost",
      rows: [
        {
          mint: "MintA",
          symbol: "Ax",
          decimals: 8,
          quantity: "5000000000",
          status: "known",
          costUsdc: "10000000",
          value: { raw: "15000", decimals: 2 },
          priceSource: "jupiter",
          priceObservedAt: "2026-11-15T12:00:00.000Z",
          unrealized: { raw: "140000000", decimals: 6 },
          unrealizedBps: 140000,
        },
      ],
      baskets: [],
      totals: {
        included: 1,
        excluded: 0,
        costUsdc: "10000000",
        value: { raw: "15000", decimals: 2 },
        unrealized: { raw: "140000000", decimals: 6 },
        unrealizedBps: 140000,
      },
      realized: null,
      sources: [],
    };
    const leg = {
      mint: "MintA",
      inputAmount: "10000000",
      basket: null,
      requestId: "r",
    };
    const csv = portfolioCsv({
      receipts: [
        {
          signature: "sig1",
          kind: "spot",
          status: "confirmed",
          mintIn: USDC_MINT,
          createdAt: new Date("2026-11-15T10:00:00Z"),
          legs: [leg],
        },
        {
          signature: "dev1",
          kind: "installment",
          status: "confirmed",
          mintIn: "Dev",
          createdAt: new Date(),
          legs: [leg],
        },
      ],
      fills: new Map([["sig1", { MintA: "5000000000" }]]),
      pnl,
    });
    const lines = csv.trimEnd().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(
      "order,2026-11-15T10:00:00.000Z,sig1,spot,confirmed,,MintA,",
    );
    expect(lines[1]).toContain(",10000000,10.000000,5000000000,");
    expect(lines[2]).toContain("pnl,");
    expect(lines[2]).toContain(
      ",5000000000,50.00000000,10000000,10.000000,150.00,140.000000,140000,known,",
    );
    expect(csv).not.toContain("dev1");
  });
});
