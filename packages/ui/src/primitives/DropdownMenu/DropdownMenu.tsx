"use client";

// Ported from apps/web/components/ui/dropdown-menu.tsx, which adapts shadcn/ui's MIT
// dropdown-menu composition onto Base UI's Menu. See ../../../SHADCN-LICENSE.md and UI-SOURCES.md.
import { Menu } from "@base-ui/react/menu";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/cn";
import { type PartProps } from "../../lib/types";
import { popupMotion } from "../../lib/styles";

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;
export const DropdownMenuGroupLabel = Menu.GroupLabel;

export interface DropdownMenuContentProps extends PartProps<typeof Menu.Popup> {
  align?: ComponentPropsWithoutRef<typeof Menu.Positioner>["align"];
  side?: ComponentPropsWithoutRef<typeof Menu.Positioner>["side"];
  sideOffset?: number;
}

/** Portaled menu. Arrow keys, Home/End and typeahead move; Enter/Space activate; Escape closes. */
export const DropdownMenuContent = forwardRef<
  HTMLDivElement,
  DropdownMenuContentProps
>(function DropdownMenuContent(
  { align = "end", side, sideOffset = 10, className, ...props },
  ref,
) {
  return (
    <Menu.Portal>
      <Menu.Positioner
        align={align}
        side={side}
        sideOffset={sideOffset}
        className="z-dropdown"
      >
        <Menu.Popup
          ref={ref}
          className={cn(
            "w-72 max-w-[calc(100vw-1.5rem)] origin-(--transform-origin) overflow-y-auto rounded-panel border border-line bg-surface p-2 text-ink shadow-float outline-none max-h-(--available-height)",
            popupMotion,
            className,
          )}
          {...props}
        />
      </Menu.Positioner>
    </Menu.Portal>
  );
});

const itemClass =
  "flex min-h-(--ovelo-control-height) w-full cursor-pointer items-center gap-3 rounded-control bg-transparent p-3 text-left text-small text-ink outline-none data-[highlighted]:bg-raised data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 [&>svg:first-child]:text-muted";

export const DropdownMenuItem = forwardRef<
  HTMLDivElement,
  PartProps<typeof Menu.Item>
>(function DropdownMenuItem({ className, ...props }, ref) {
  return (
    <Menu.Item ref={ref} className={cn(itemClass, className)} {...props} />
  );
});

/** Item rendered as a link: pass `render={<a href="..." />}`; the menu closes on click. */
export const DropdownMenuAnchorItem = forwardRef<
  HTMLDivElement,
  PartProps<typeof Menu.Item>
>(function DropdownMenuAnchorItem({ className, ...props }, ref) {
  return (
    <Menu.Item
      ref={ref}
      nativeButton={false}
      closeOnClick
      className={cn(itemClass, className)}
      {...props}
    />
  );
});

export const DropdownMenuSeparator = forwardRef<
  HTMLDivElement,
  PartProps<typeof Menu.Separator>
>(function DropdownMenuSeparator({ className, ...props }, ref) {
  return (
    <Menu.Separator
      ref={ref}
      className={cn("mx-3 my-2 h-px bg-line", className)}
      {...props}
    />
  );
});
