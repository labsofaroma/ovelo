import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/**
 * W1 (REWRITE-PLAN §7.3): v1 code is wallet-only. The rule in apps/web/eslint.config.mjs must
 * fire on any `@privy-io/*` import from a v1 path and leave the prototype alone until M9.
 */
const cwd = fileURLToPath(new URL("..", import.meta.url));
const eslint = new ESLint({ cwd });

const SOURCES = {
  static:
    'import { usePrivy } from "@privy-io/react-auth";\nexport const x = usePrivy;\n',
  subpath:
    'import { useWallets } from "@privy-io/react-auth/solana";\nexport const x = useWallets;\n',
  reexport: 'export { PrivyProvider } from "@privy-io/react-auth";\n',
  dynamic: 'export const load = () => import("@privy-io/react-auth");\n',
};

async function messages(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((m) => /wallet-only/.test(m.message));
}

describe("v1 lint rule: no @privy-io imports (W1)", () => {
  it.each([
    "features/wallet/stack/Fixture.tsx",
    "server/fixture.ts",
    "app/(app)/v1/fixture.tsx",
    "app/api/v1/fixture/route.ts",
    "middleware.ts",
  ])(
    "fires in v1 path %s for every import form",
    async (path) => {
      for (const code of Object.values(SOURCES)) {
        const found = await messages(path, code);
        expect(found.length, `${path}: ${code}`).toBeGreaterThan(0);
        expect(found.every((m) => m.severity === 2)).toBe(true);
      }
    },
    30_000,
  );

  it("does not fire on the prototype (removed in M9) or on Wallet Standard imports", async () => {
    expect(
      await messages("components/auth/Fixture.tsx", SOURCES.static),
    ).toEqual([]);
    expect(
      await messages(
        "features/wallet/stack/Fixture.tsx",
        'import { useWallet } from "@solana/wallet-adapter-react";\nexport const x = useWallet;\n',
      ),
    ).toEqual([]);
  }, 30_000);
});
