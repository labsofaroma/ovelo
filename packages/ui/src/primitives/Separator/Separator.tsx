"use client";

import { Separator as BaseSeparator } from "@base-ui/react/separator";
import { forwardRef } from "react";
import { cn } from "../../lib/cn";
import { type PartProps } from "../../lib/types";

export type SeparatorProps = PartProps<typeof BaseSeparator>;

/** Base UI separator (role="separator" with aria-orientation). Decorative lines: `aria-hidden`. */
export const Separator = forwardRef<HTMLDivElement, SeparatorProps>(
  function Separator({ orientation = "horizontal", className, ...props }, ref) {
    return (
      <BaseSeparator
        ref={ref}
        orientation={orientation}
        className={cn(
          "shrink-0 bg-line",
          orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
          className,
        )}
        {...props}
      />
    );
  },
);
