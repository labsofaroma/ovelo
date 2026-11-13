import reactHooks from "eslint-plugin-react-hooks";
import { createConfig } from "@aroma/config/eslint";

const boundaryMessage =
  "@aroma/ui is a pure presentation layer: no app code, server-only code, wallet or Solana packages. " +
  "Inject behaviour from the app through props instead.";

const forbidden = [
  // Apps and server code.
  {
    group: [
      "@aroma/web",
      "@aroma/web/*",
      "@aroma/keeper",
      "@aroma/keeper/*",
      "@aroma/anchor",
      "@aroma/anchor/*",
    ],
    message: boundaryMessage,
  },
  { group: ["**/apps/*", "**/apps/**"], message: boundaryMessage },
  {
    group: ["server-only", "**/server/**", "**/lib/server/**"],
    message: boundaryMessage,
  },
  // Wallets and chains.
  {
    group: [
      "@solana/*",
      "@solana-program/*",
      "@coral-xyz/*",
      "@privy-io/*",
      "@farcaster/*",
      "@wallet-standard/*",
      "@reown/*",
      "@walletconnect/*",
      "viem",
      "viem/*",
      "wagmi",
      "ethers",
    ],
    message: boundaryMessage,
  },
  // Frameworks: components take router and image components as props.
  { group: ["next", "next/*"], message: boundaryMessage },
];

export default [
  ...createConfig({
    dir: import.meta.dirname,
    // Generated file: one long line per logo by design.
    ignores: ["logos.ts", "dist/**", "playwright-report/**", "test-results/**"],
  }),
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-restricted-imports": ["error", { patterns: forbidden }],
    },
  },
];
