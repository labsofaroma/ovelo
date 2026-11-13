import { defineConfig } from "vitest/config";
import preset from "@aroma/config/vitest";

export default defineConfig({
  ...preset,
  test: {
    ...preset.test,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    css: { modules: { classNameStrategy: "non-scoped" } },
  },
});
