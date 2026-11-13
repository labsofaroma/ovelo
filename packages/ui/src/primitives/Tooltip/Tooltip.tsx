"use client";

import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { cn } from "../../lib/cn";
import { type PartProps } from "../../lib/types";
import { popupMotion } from "../../lib/styles";

export const TooltipProvider = BaseTooltip.Provider;
export const Tooltip = BaseTooltip.Root;
export const TooltipTrigger = BaseTooltip.Trigger;

export interface TooltipContentProps extends PartProps<
  typeof BaseTooltip.Popup
> {
  side?: ComponentPropsWithoutRef<typeof BaseTooltip.Positioner>["side"];
  sideOffset?: number;
  children: ReactNode;
}

/**
 * Short supplementary label shown on hover and keyboard focus. The trigger must have its own
 * accessible name (the tooltip only repeats it visually). Never put essential or interactive
 * content in a tooltip; it is not reachable on touch.
 */
export const TooltipContent = forwardRef<HTMLDivElement, TooltipContentProps>(
  function TooltipContent(
    { side = "top", sideOffset = 6, className, ...props },
    ref,
  ) {
    return (
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner
          side={side}
          sideOffset={sideOffset}
          className="z-tooltip"
        >
          <BaseTooltip.Popup
            ref={ref}
            role="tooltip"
            className={cn(
              "max-w-64 rounded-control bg-ink px-3 py-1.5 text-caption font-medium text-bg",
              popupMotion,
              className,
            )}
            {...props}
          />
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    );
  },
);
