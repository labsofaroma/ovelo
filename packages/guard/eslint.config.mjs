import { createConfig } from "@aroma/config/eslint";

// The Codama output is generated (marked GENERATED in every file) and not linted.
export default createConfig({
  dir: import.meta.dirname,
  ignores: ["src/v1/generated/**", "scripts/**"],
});
