import { createConfig } from "@aroma/config/eslint";

/**
 * One rule set for the whole app (M9: the prototype is gone, so there are no legacy, warn-only
 * zones left; every rule reports as an error).
 */
export default [
  ...createConfig({
    dir: import.meta.dirname,
    next: true,
  }),
];
