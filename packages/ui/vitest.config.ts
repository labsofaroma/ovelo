import { defineConfig } from "vitest/config";
import preset from "@aroma/config/vitest";

export default defineConfig({
  ...preset,
  test: { ...preset.test, include: ["src/**/*.test.ts"] },
});
