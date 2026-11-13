import { describe, expect, it } from "vitest";
import { UI_PACKAGE } from "./index";

describe("@aroma/ui", () => {
  it("exposes the placeholder export", () => {
    expect(UI_PACKAGE).toBe("@aroma/ui");
  });
});
