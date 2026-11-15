import { createConfig } from "@ovelo/config/eslint";

/**
 * One rule set for the whole app (M9: the prototype is gone, so there are no legacy, warn-only
 * zones left; every rule reports as an error).
 */
export default [
  ...createConfig({
    dir: import.meta.dirname,
    next: true,
  }),
  // Phase H: server/platform.ts is the only reader of Vercel's variables (VERCEL, VERCEL_ENV,
  // VERCEL_*). Everyone else asks it (productionRules, deployEnvOf, …), so self-host and Vercel
  // answer the same questions in one place.
  {
    files: ["**/*.{ts,tsx,mts,mjs,js}"],
    ignores: ["server/platform.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name=/^VERCEL/]",
          message:
            "Read the platform through server/platform.ts (productionRules, deployEnvOf), not VERCEL* directly.",
        },
        {
          selector: "MemberExpression[computed=true][property.value=/^VERCEL/]",
          message:
            "Read the platform through server/platform.ts (productionRules, deployEnvOf), not VERCEL* directly.",
        },
      ],
    },
  },
];
