import { describe, expect, it } from "vitest";
import { bucketFor, LIMITS } from "./request-guard";

describe("M7 rate buckets", () => {
  it("plan prepare and submit share the trade bucket; the faucet has its own; reads stay reads", () => {
    expect(bucketFor("/api/v1/plans/prepare-create", "POST")).toBe("trade");
    expect(bucketFor("/api/v1/plans/submit", "POST")).toBe("trade");
    expect(
      bucketFor(
        "/api/v1/plans/9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin/prepare-close",
        "POST",
      ),
    ).toBe("trade");
    expect(
      bucketFor("/api/v1/plans/not-an-address!/prepare-close", "POST"),
    ).toBe("write");
    expect(bucketFor("/api/v1/faucet", "POST")).toBe("faucet");
    expect(bucketFor("/api/v1/plans", "GET")).toBe("read");
    expect(LIMITS.faucet).toEqual({ limit: 5, windowSeconds: 60 });
  });
});
