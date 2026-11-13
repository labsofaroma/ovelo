import type { ViteUserConfig } from "vitest/config";
declare const preset: ViteUserConfig & {
  test: NonNullable<ViteUserConfig["test"]>;
};
export default preset;
