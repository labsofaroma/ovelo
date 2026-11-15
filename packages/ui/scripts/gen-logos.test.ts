// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLogosSource, OUTPUT_FILE, readSources } from "./gen-logos";
import { COMPANY_LOGO_BASE_PATH, companyLogos } from "../logos";
import { getCompanyLogo } from "../src/domain/AssetAvatar/logo-lookup";

describe("generated logos.ts", () => {
  it("is up to date with apps/web/public/company-logos (run `pnpm --filter @ovelo/ui gen:logos`)", () => {
    const { manifest, files } = readSources();
    expect(readFileSync(OUTPUT_FILE, "utf8")).toBe(
      buildLogosSource(manifest, files),
    );
  });

  it("fails loudly when the manifest lists a missing file or the directory has an orphan", () => {
    const { manifest, files } = readSources();
    expect(() =>
      buildLogosSource(
        manifest,
        files.filter((f) => f !== "aapl.webp"),
      ),
    ).toThrow(/do not exist/);
    expect(() => buildLogosSource(manifest, [...files, "stray.webp"])).toThrow(
      /missing from manifest/,
    );
  });

  it("rejects a duplicated mint", () => {
    const { manifest, files } = readSources();
    const first = manifest.logos[0];
    if (!first) throw new Error("manifest is empty");
    const dup = {
      ...manifest,
      logos: [...manifest.logos, { ...first, file: first.file }],
    };
    expect(() => buildLogosSource(dup, files)).toThrow();
  });

  it("resolves every manifest mint to its served path", () => {
    expect(companyLogos.length).toBeGreaterThan(40);
    for (const logo of companyLogos) {
      for (const mint of logo.mints) {
        expect(getCompanyLogo({ symbol: "ZZZ", mint })).toBe(
          `${COMPANY_LOGO_BASE_PATH}/${logo.file}`,
        );
      }
    }
  });
});
