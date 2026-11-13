import "vitest";

interface AxeMatchers {
  toHaveNoViolations(): void;
}

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars -- vitest-axe documents this exact augmentation shape
  interface Assertion<T = any> extends AxeMatchers {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- same augmentation, asymmetric matchers
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
