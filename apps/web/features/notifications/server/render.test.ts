import { describe, expect, it } from "vitest";
import { formatRaw, renderEvent } from "./render";

const SITE = "https://aroma.example";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

describe("formatRaw (bigint only)", () => {
  it.each([
    ["25000000", 6, "25"],
    ["25000001", 6, "25.000001"],
    ["1", 9, "0.000000001"],
    ["0", 6, "0"],
    ["18446744073709551615", 6, "18446744073709.551615"],
  ])("%s at %i decimals → %s", (raw, decimals, text) => {
    expect(formatRaw(raw, decimals)).toBe(text);
  });
  it("refuses anything but a raw integer", () => {
    expect(() => formatRaw("1.5", 6)).toThrow();
  });
});

describe("renderEvent: facts only, labelled cluster", () => {
  const trade = (kind: string, payload = {}) => ({
    id: "e",
    kind,
    cluster: "mainnet" as const,
    payload: {
      target: "spot",
      label: "TSLAx",
      mint: USDC,
      amountRaw: "25000000",
      signature: "5ig",
      ...payload,
    },
  });

  it("a confirmed spot purchase: the amount from the receipt, mainnet, the explorer link", () => {
    expect(renderEvent(trade("trade_confirmed"), SITE)).toEqual({
      title: "Purchase confirmed",
      body: "TSLAx: 25 USDC spent. Confirmed on Solana mainnet.",
      url: "https://solscan.io/tx/5ig",
    });
  });

  it("a failed basket order says what a failed transaction means, without a guess", () => {
    const message = renderEvent(
      trade("trade_failed", { target: "basket", label: "Core" }),
      SITE,
    );
    expect(message?.title).toBe("Purchase failed");
    expect(message?.body).toContain("Basket Core");
    expect(message?.body).toContain("network fee is charged");
  });

  it("devnet events say [Devnet test] and use the devnet explorer", () => {
    const message = renderEvent(
      {
        id: "p",
        kind: "plan_round_executed",
        cluster: "devnet",
        payload: {
          plan: "PLANaaaaaaaaaaaaaaaaaaaaaaaaaaaaZZZZ",
          period: 2,
          signature: "s",
          amountRaw: "10000000",
          mint: "TestMint",
          decimals: 6,
          symbol: "test tokens",
        },
      },
      SITE,
    );
    expect(message?.title).toBe("[Devnet test] Recurring round ran");
    expect(message?.body).toBe(
      "Plan PLAN…ZZZZ, round 3: 10 test tokens spent. Devnet test tokens have no value.",
    );
    expect(message?.url).toBe("https://solscan.io/tx/s?cluster=devnet");
  });

  it("an unknown mint shows raw units, never a guessed price or symbol", () => {
    expect(
      renderEvent(trade("trade_confirmed", { mint: "Unknown1111" }), SITE)
        ?.body,
    ).toContain("25000000 raw units of Unkn…");
  });

  it.each([
    [
      "unknown kind",
      { id: "x", kind: "nope", cluster: "mainnet" as const, payload: {} },
    ],
    ["missing signature", trade("trade_confirmed", { signature: undefined })],
    [
      "a mainnet event on devnet",
      { ...trade("trade_confirmed"), cluster: "devnet" as const },
    ],
    ["a malformed amount", trade("trade_confirmed", { amountRaw: "1e9" })],
  ])("renders nothing for %s", (_name, event) => {
    expect(renderEvent(event, SITE)).toBeNull();
  });
});
