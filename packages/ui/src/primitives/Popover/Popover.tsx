"use client";

import { Popover as BasePopover } from "@base-ui/react/popover";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/cn";
import { type PartProps } from "../../lib/types";
import { popupMotion, popupSurface } from "../../lib/styles";

export const Popover = BasePopover.Root;
export const PopoverTrigger = BasePopover.Trigger;
export const PopoverClose = BasePopover.Close;
export const PopoverTitle = BasePopover.Title;
export const PopoverDescription = BasePopover.Description;

export interface PopoverContentProps extends PartProps<
  typeof BasePopover.Popup
> {
  side?: ComponentPropsWithoutRef<typeof BasePopover.Positioner>["side"];
  align?: ComponentPropsWithoutRef<typeof BasePopover.Positioner>["align"];
  sideOffset?: number;
}

/** Non-modal floating panel anchored to its trigger. Escape closes; focus returns to the trigger. */
export const PopoverContent = forwardRef<HTMLDivElement, PopoverContentProps>(
  function PopoverContent(
    { side = "bottom", align = "center", sideOffset = 8, className, ...props },
    ref,
  ) {
    return (
      <BasePopover.Portal>
        <BasePopover.Positioner
          side={side}
          align={align}
          sideOffset={sideOffset}
          className="z-popover"
        >
          <BasePopover.Popup
            ref={ref}
            className={cn(
              popupSurface,
              popupMotion,
              "w-72 p-4 text-small",
              className,
            )}
            {...props}
          />
        </BasePopover.Positioner>
      </BasePopover.Portal>
    );
  },
);
