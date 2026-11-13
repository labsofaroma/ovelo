import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import preset from "@aroma/config/vitest";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  ...preset,
  resolve: {
    alias: {
      // `server-only` throws outside the react-server condition; unit tests run in plain Node.
      "server-only": here("./server/test/server-only-stub.ts"),
      "@": here("."),
    },
  },
  test: {
    ...preset.test,
    // The prototype node:test suites keep running through `test:legacy` until M2 ports them.
    include: ["server/**/*.test.ts"],
    coverage: { ...preset.test.coverage, include: ["server/**/*.ts"] },
  },
});
