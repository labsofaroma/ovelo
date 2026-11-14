import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import {
  isPrototypePath,
  resolveInApp,
} from "../eslint/no-prototype-imports.mjs";

/**
 * M9 Step 1: kept code never imports prototype code. The local rule in
 * apps/web/eslint/no-prototype-imports.mjs, run through this app's real ESLint config.
 */
const cwd = fileURLToPath(new URL("..", import.meta.url));
const eslint = new ESLint({ cwd });

async function prototypeErrors(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter(
    (m) => m.ruleId === "aroma/no-prototype-imports",
  );
}

const FORMS = (spec: string) => [
  `import { x } from "${spec}";\nexport const y = x;\n`,
  `export { x } from "${spec}";\n`,
  `export * from "${spec}";\n`,
  `export const load = () => import("${spec}");\n`,
  `export type T = import("${spec}").X;\n`,
  `// eslint-disable-next-line @typescript-eslint/no-require-imports\nexport const r = require("${spec}");\n`,
];

describe("no-prototype-imports: fires from kept code", () => {
  it.each([
    ["features/trade/fixture.ts", "@/lib/server/redis"],
    ["features/trade/fixture.ts", "@/components/aroma/Brand"],
    ["features/trade/fixture.ts", "@/styles/foundation.css"],
    ["features/trade/fixture.ts", "@/lib/site"],
    ["features/trade/fixture.ts", "@/lib/sdk"],
    ["features/trade/fixture.ts", "@/lib/sdk/client/aroma-client"],
    ["features/trade/fixture.ts", "@/lib/sdk/guard/devnet"],
    ["features/trade/fixture.ts", "@/app/(prototype)/not-found"],
    ["features/trade/fixture.ts", "@/app/api/trade/order/route"],
    ["app/robots.ts", "../lib/site"],
    ["app/global-not-found.tsx", "./(prototype)/globals.css"],
    ["lib/sdk/baskets/fixture.ts", "../recurring-investing"],
    ["lib/sdk/baskets/fixture.ts", "../index"],
    ["lib/sdk/baskets/custom/fixture.test.ts", "../../index"],
    ["lib/sdk/jupiter/fixture.test.ts", "../../../tests/sdk/fixtures/x.json"],
    ["server/fixture.ts", "../lib/server/mainnet-connection"],
  ])("%s → %s, every import form", async (file, spec) => {
    for (const code of FORMS(spec)) {
      const found = await prototypeErrors(file, code);
      expect(found.length, `${file}: ${code}`).toBe(1);
      expect(found[0]?.severity).toBe(2);
    }
  }, 60_000);
});

describe("no-prototype-imports: quiet where it must be", () => {
  it.each([
    // v1 feature folders are also called components/
    ["features/baskets/builder/fixture.tsx", "../components/AllocationTable"],
    ["features/invest/fixture.ts", "./components/types"],
    // a sub-barrel is not the lib/sdk barrel
    ["lib/sdk/markets/sources/fixture.test.ts", "../index"],
    ["lib/sdk/baskets/fixture.ts", "./mainnet"],
    ["lib/sdk/baskets/fixture.ts", "../guard/v1"],
    // the versioned API stays
    ["features/trade/fixture.ts", "@/app/api/v1/trade/quote/route"],
    // leaving the app (root scripts) and packages are out of scope
    ["server/fixture.ts", "../../../scripts/check-client-secrets.mjs"],
    ["features/trade/fixture.ts", "@aroma/guard"],
    // prototype files may still import each other until they are deleted
    ["components/aroma/Fixture.tsx", "@/lib/server/redis"],
    ["lib/server/fixture.ts", "@/lib/sdk"],
  ])("%s → %s", async (file, spec) => {
    expect(
      await prototypeErrors(
        file,
        `import { x } from "${spec}";\nexport const y = x;\n`,
      ),
    ).toEqual([]);
  }, 60_000);
});

describe("path helpers", () => {
  it("resolves aliases and relative specifiers inside apps/web", () => {
    expect(resolveInApp("features/a/b.ts", "@/lib/sdk/index.ts")).toBe(
      "lib/sdk",
    );
    expect(resolveInApp("lib/sdk/baskets/x.ts", "../index")).toBe("lib/sdk");
    expect(resolveInApp("lib/sdk/markets/sources/x.ts", "../index")).toBe(
      "lib/sdk/markets",
    );
    expect(resolveInApp("server/x.ts", "../../scripts/a.mjs")).toBeNull();
    expect(resolveInApp("server/x.ts", "zod")).toBeNull();
  });

  it("classifies the CUTOVER-MAP groups and nothing else", () => {
    for (const p of [
      "app/(prototype)/layout.tsx",
      "app/api/health/route.ts",
      "components/trading/TradingAuth.tsx",
      "lib/sdk/index.shared.ts",
      "lib/sdk/subscriptions/mainnet.ts",
      "lib/sdk/wallet-capabilities.test.ts",
      "tests/trading.test.mjs",
    ])
      expect(isPrototypePath(p), p).toBe(true);
    for (const p of [
      "app/api/v1/health/route.ts",
      "app/(app)/v1/layout.tsx",
      "features/shared/components/NotFound.tsx",
      "lib/sdk/guard/v1/index.ts",
      "lib/sdk/baskets/mainnet.ts",
      "lib/sdk/markets/index.ts",
      "server/rpc.ts",
    ])
      expect(isPrototypePath(p), p).toBe(false);
  });
});
