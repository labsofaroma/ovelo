"use client";

// Adapted from shadcn/ui's MIT dropdown-menu composition, using the Base UI
// primitives already present in Aroma. See SHADCN-LICENSE.md and UI-SOURCES.md.
import { Menu } from "@base-ui/react/menu";
import type { ComponentProps } from "react";

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;

export function DropdownMenuContent({
  children,
  className = "",
  align = "end",
  sideOffset = 10,
  ...props
}: Omit<ComponentProps<typeof Menu.Popup>, "className"> & {
  className?: string;
  align?: ComponentProps<typeof Menu.Positioner>["align"];
  sideOffset?: number;
}) {
  return (
    <Menu.Portal>
      <Menu.Positioner
        align={align}
        sideOffset={sideOffset}
        className="aroma-menu-positioner"
      >
        <Menu.Popup className={`aroma-menu ${className}`} {...props}>
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
}

export function DropdownMenuItem({
  className = "",
  ...props
}: ComponentProps<typeof Menu.Item>) {
  return <Menu.Item className={`aroma-menu-item ${className}`} {...props} />;
}

export function DropdownMenuAnchorItem({
  className = "",
  ...props
}: ComponentProps<typeof Menu.Item>) {
  return (
    <Menu.Item
      nativeButton={false}
      closeOnClick
      className={`aroma-menu-item ${className}`}
      {...props}
    />
  );
}

export function DropdownMenuSeparator(
  props: ComponentProps<typeof Menu.Separator>,
) {
  return <Menu.Separator className="aroma-menu-separator" {...props} />;
}
