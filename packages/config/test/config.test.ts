import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("@aroma/config", () => {
  it("ships a strict tsconfig base with noUncheckedIndexedAccess", () => {
    const base = JSON.parse(
      readFileSync(new URL("../tsconfig.base.json", import.meta.url), "utf8"),
    ) as { compilerOptions: Record<string, unknown> };
    expect(base.compilerOptions.strict).toBe(true);
    expect(base.compilerOptions.noUncheckedIndexedAccess).toBe(true);
  });

  it("keeps the max-lines allowlist as a list of repo-relative source paths", () => {
    const list = JSON.parse(
      readFileSync(
        new URL("../max-lines-allowlist.json", import.meta.url),
        "utf8",
      ),
    ) as { max: number; files: string[] };
    expect(list.max).toBe(400);
    expect(list.files.length).toBeGreaterThan(0);
    for (const file of list.files) expect(file.startsWith("/")).toBe(false);
  });
});
