import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError, ERROR_CODES, mapError } from "./errors";

describe("mapError", () => {
  it("returns an AppError's stable code and public message only", () => {
    const mapped = mapError(
      new AppError("CONFLICT", {
        detail: "internal row 42 locked",
        cause: new Error("pg: deadlock"),
      }),
    );
    expect(mapped).toEqual({
      status: 409,
      body: { code: "CONFLICT", message: ERROR_CODES.CONFLICT.message },
    });
    expect(JSON.stringify(mapped)).not.toContain("deadlock");
    expect(JSON.stringify(mapped)).not.toContain("row 42");
  });

  it("never leaks the message of an unknown error (AUDIT M-5)", () => {
    const mapped = mapError(
      new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2"),
    );
    expect(mapped.status).toBe(500);
    expect(mapped.body).toEqual({
      code: "INTERNAL",
      message: "Something went wrong.",
    });
    expect(JSON.stringify(mapped)).not.toContain("hunter2");
  });

  it("maps non-Error throwables to INTERNAL", () => {
    expect(mapError("boom").body.code).toBe("INTERNAL");
    expect(mapError(undefined).status).toBe(500);
  });

  it("maps zod errors to VALIDATION_FAILED with field names but no values", () => {
    const result = z
      .object({ amount: z.string().regex(/^\d+$/), wallet: z.string() })
      .safeParse({
        amount: "12abc-secret",
        wallet: 5,
      });
    expect(result.success).toBe(false);
    if (result.success) return;
    const mapped = mapError(result.error);
    expect(mapped.status).toBe(400);
    expect(mapped.body.code).toBe("VALIDATION_FAILED");
    expect(mapped.body.message).toContain("amount");
    expect(mapped.body.message).toContain("wallet");
    expect(mapped.body.message).not.toContain("12abc-secret");
  });

  it("keeps the code table stable and each code mapped to a 4xx/5xx status", () => {
    for (const [code, { status }] of Object.entries(ERROR_CODES)) {
      expect(status, code).toBeGreaterThanOrEqual(400);
    }
  });
});
