import { describe, expect, it } from "vitest";
import { bucketFor, clientIp, LIMITS, maxBodyBytes } from "./request-guard";

describe("bucketFor", () => {
  it("reads are one bucket whatever the path", () => {
    for (const path of [
      "/api/v1/creators/challenge",
      "/api/v1/trade/quote",
      "/api/markets",
    ]) {
      expect(bucketFor(path, "GET")).toBe("read");
      expect(bucketFor(path, "HEAD")).toBe("read");
    }
  });

  it("trades keep their own bucket", () => {
    expect(bucketFor("/api/v1/trade/quote", "POST")).toBe("trade");
    expect(bucketFor("/api/v1/trade/submit", "POST")).toBe("trade");
    // M9: the prototype trade paths are gone (410 before any bucket), so they have no bucket.
    expect(bucketFor("/api/buy-basket", "POST")).toBe("write");
  });

  it("challenge issuance and invite redemption use the tighter creator bucket", () => {
    expect(bucketFor("/api/v1/creators/challenge", "POST")).toBe("creator");
    expect(bucketFor("/api/v1/creators/invites/redeem", "POST")).toBe(
      "creator",
    );
    expect(LIMITS.creator.limit).toBeLessThan(LIMITS.write.limit);
  });

  it("other creator mutations stay in the write bucket (each consumes a challenge)", () => {
    expect(bucketFor("/api/v1/creators/baskets", "POST")).toBe("write");
    expect(
      bucketFor(
        "/api/v1/creators/baskets/1f0e6a7c-3c2b-4f53-9d55-0d7c8f0c2a11",
        "DELETE",
      ),
    ).toBe("write");
    // Look-alikes do not match.
    expect(bucketFor("/api/v1/creators/challenge/x", "POST")).toBe("write");
    expect(bucketFor("/api/creators/challenge", "POST")).toBe("write");
  });
});

describe("clientIp", () => {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
  it("is per client behind a trusted proxy", () => {
    expect(clientIp(headers, { VERCEL: "1" })).toBe("203.0.113.9");
    expect(clientIp(headers, { AROMA_TRUST_PROXY: "true" })).toBe(
      "203.0.113.9",
    );
  });
  it("ignores spoofable headers without one", () => {
    expect(clientIp(headers, {})).toBe("local");
  });
});

describe("maxBodyBytes", () => {
  it("16 KiB for creator routes, 32 KiB only for bundle and v1 submit", () => {
    expect(maxBodyBytes("/api/v1/creators/baskets")).toBe(16_384);
    expect(maxBodyBytes("/api/v1/trade/submit")).toBe(32_768);
  });
});
