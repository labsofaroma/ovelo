import type { ComponentPropsWithoutRef, ElementType } from "react";

/**
 * Props of a Base UI part, with `className` narrowed to a plain string. Base UI also allows
 * a state callback; the wrappers merge classes themselves, so they only accept strings.
 */
export type PartProps<T extends ElementType> = Omit<
  ComponentPropsWithoutRef<T>,
  "className"
> & {
  className?: string;
};
