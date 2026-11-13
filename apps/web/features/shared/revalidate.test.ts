import { describe, expect, it } from "vitest";
import { AppError } from "@/server/errors";
import { mint } from "../test/fixtures";
import { assertRevalidateAuthorized, revalidateBodySchema } from "./revalidate";

const SECRET = "s".repeat(40);

describe("assertRevalidateAuthorized", () => {
  it("accepts the right bearer token", () => {
    expect(() =>
      assertRevalidateAuthorized(`Bearer ${SECRET}`, SECRET),
    ).not.toThrow();
  });
  it.each([
    null,
    "",
    SECRET,
    `Bearer ${SECRET}x`,
    `Basic ${SECRET}`,
    "Bearer ",
  ])("rejects %s", (header) => {
    expect(() => assertRevalidateAuthorized(header, SECRET)).toThrow(AppError);
  });
  it("fails closed when no secret is configured", () => {
    try {
      assertRevalidateAuthorized(`Bearer ${SECRET}`, undefined);
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as AppError).code).toBe("SERVICE_UNAVAILABLE");
    }
  });
});

describe("revalidateBodySchema", () => {
  it("allows only known tags", () => {
    expect(
      revalidateBodySchema.safeParse({ tags: ["v1:markets"] }).success,
    ).toBe(true);
    expect(
      revalidateBodySchema.safeParse({ tags: [`v1:research:${mint(1)}`] })
        .success,
    ).toBe(true);
    for (const tags of [
      [],
      ["anything"],
      ["v1:markets:x"],
      [`v1:markets:${mint(1)}`],
    ])
      expect(revalidateBodySchema.safeParse({ tags }).success).toBe(false);
  });
});
