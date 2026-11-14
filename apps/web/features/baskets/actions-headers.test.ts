import { describe, expect, it } from "vitest";
import { actionHeaders } from "./actions-headers";

// CAIP-2 Solana chain ids are the first 32 characters of the genesis hash.
const MAINNET_CHAIN = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const DEVNET_CHAIN = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

describe("actionHeaders", () => {
  it("defaults to mainnet with the spec version, CORS and no caching", () => {
    const headers = actionHeaders();
    expect(headers["X-Blockchain-Ids"]).toBe(MAINNET_CHAIN);
    expect(headers["X-Action-Version"]).toBe("2.4");
    expect(headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(headers["Access-Control-Expose-Headers"]).toBe(
      "X-Blockchain-Ids, X-Action-Version, Retry-After",
    );
    expect(headers["Cache-Control"]).toBe("no-store");
  });

  it("names devnet only when asked", () => {
    expect(actionHeaders("devnet")["X-Blockchain-Ids"]).toBe(DEVNET_CHAIN);
  });

  it("returns a fresh object, so callers cannot change another response's headers", () => {
    const first = actionHeaders();
    first["Cache-Control"] = "public";
    expect(actionHeaders()["Cache-Control"]).toBe("no-store");
  });
});
