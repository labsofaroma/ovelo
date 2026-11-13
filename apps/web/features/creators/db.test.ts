import { describe, expect, it } from "vitest";
import { AppError } from "@/server/errors";
import { isDatabaseUnavailable, mapDbError, pgError } from "./db";

describe("database error classification", () => {
  it("treats connection failures as an outage", () => {
    expect(isDatabaseUnavailable({ type: "error" })).toBe(true); // Neon's ErrorEvent
    // Drizzle wraps the driver's rejection in DrizzleQueryError { cause }.
    expect(
      isDatabaseUnavailable(
        new Error("Failed query", { cause: { type: "error" } }),
      ),
    ).toBe(true);
    expect(
      isDatabaseUnavailable(
        Object.assign(new Error("x"), { code: "ENOTFOUND" }),
      ),
    ).toBe(true);
    expect(
      isDatabaseUnavailable(new Error("wrapped", { cause: { code: "08006" } })),
    ).toBe(true);
    expect(isDatabaseUnavailable({ code: "57P01" })).toBe(true);
  });

  it("does not hide bugs or constraint violations", () => {
    expect(isDatabaseUnavailable(new Error("bug"))).toBe(false);
    expect(isDatabaseUnavailable({ code: "23505" })).toBe(false);
    expect(isDatabaseUnavailable(null)).toBe(false);
    expect(isDatabaseUnavailable("text")).toBe(false);
  });

  it("finds SQLSTATE through Drizzle's wrapper and maps violations", () => {
    const wrapped = new Error("query failed", {
      cause: { code: "23505", constraint: "baskets_ticker_unique" },
    });
    expect(pgError(wrapped)).toEqual({
      code: "23505",
      constraint: "baskets_ticker_unique",
    });
    expect(pgError(new Error("plain"))).toBeNull();
    const conflict = (() => {
      try {
        mapDbError({ code: "23505", constraint: "creators_pkey" });
      } catch (error) {
        return error as AppError;
      }
    })();
    expect(conflict?.code).toBe("CONFLICT");
    expect(() => mapDbError({ code: "23514" })).toThrow(AppError);
    const unknown = new Error("other");
    expect(() => mapDbError(unknown)).toThrow(unknown);
  });
});
