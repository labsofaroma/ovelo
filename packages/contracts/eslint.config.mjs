import { createConfig } from "@ovelo/config/eslint";

export default [
  ...createConfig({ dir: import.meta.dirname, ignores: ["target/**"] }),
  {
    // Command-line tools: printing their result to stdout is their interface.
    files: ["scripts/**"],
    rules: { "no-console": "off" },
  },
];
