import { createConfig } from "@ovelo/config/eslint";

// The Codama output is generated (marked GENERATED in every file) and not linted; the pinned
// Jupiter IDL is protocol metadata read from mainnet (src/jupiter/idl/README.md), not code.
export default createConfig({
  dir: import.meta.dirname,
  ignores: ["src/v1/generated/**", "src/jupiter/idl/**", "scripts/**"],
});
