import { defineConfig } from "vitest/config";
import preset from "./vitest.preset.mjs";

export default defineConfig({
  ...preset,
  test: { ...preset.test, include: ["test/**/*.test.ts"] },
});
