import { forwardRef } from "react";
import { cn } from "../../lib/cn";
import { Button, type ButtonProps } from "../Button";

export interface IconButtonProps extends Omit<
  ButtonProps,
  "fullWidth" | "children" | "aria-label"
> {
  /** Required: an icon alone has no accessible name. */
  "aria-label": string;
  /** The icon element. Mark it aria-hidden (lucide icons are by default when sized). */
  icon: React.ReactNode;
}

const SQUARE = {
  sm: "size-(--aroma-control-height-compact) max-md:size-(--aroma-control-height)",
  md: "size-(--aroma-control-height)",
  lg: "size-12",
} as const;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { icon, size = "md", variant = "ghost", className, ...props },
    ref,
  ) {
    return (
      <Button
        ref={ref}
        variant={variant}
        size={size}
        className={cn("shrink-0 px-0", SQUARE[size], className)}
        {...props}
      >
        <span aria-hidden="true" className="inline-flex">
          {icon}
        </span>
      </Button>
    );
  },
);
