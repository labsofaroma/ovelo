import { describe, expect, it } from "vitest";
import { KEEPER_PACKAGE } from "./index";

describe("@aroma/keeper", () => {
  it("exposes the placeholder export", () => {
    expect(KEEPER_PACKAGE).toBe("@aroma/keeper");
  });
});
