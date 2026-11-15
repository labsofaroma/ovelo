"use client";

import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { forwardRef } from "react";
import { cn } from "../../lib/cn";
import { type PartProps } from "../../lib/types";
import { focusRing } from "../../lib/styles";

export const Tabs = BaseTabs.Root;

export const TabsList = forwardRef<
  HTMLDivElement,
  PartProps<typeof BaseTabs.List>
>(function TabsList({ className, children, ...props }, ref) {
  return (
    <BaseTabs.List
      ref={ref}
      className={cn("relative flex gap-1 border-b border-line", className)}
      {...props}
    >
      {children}
      <BaseTabs.Indicator className="absolute bottom-0 left-(--active-tab-left) h-0.5 w-(--active-tab-width) bg-accent transition-[left,width] motion-base" />
    </BaseTabs.List>
  );
});

/** Arrow keys move between tabs, Home/End jump, Tab moves into the panel. */
export const TabsTrigger = forwardRef<
  HTMLButtonElement,
  PartProps<typeof BaseTabs.Tab>
>(function TabsTrigger({ className, ...props }, ref) {
  return (
    <BaseTabs.Tab
      ref={ref}
      className={cn(
        "min-h-(--ovelo-control-height) cursor-pointer rounded-t-control px-4 text-small font-semibold text-muted transition-colors motion-base hover:text-ink",
        "data-[active]:text-ink data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        focusRing,
        className,
      )}
      {...props}
    />
  );
});

export const TabsContent = forwardRef<
  HTMLDivElement,
  PartProps<typeof BaseTabs.Panel>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <BaseTabs.Panel
      ref={ref}
      className={cn("pt-4 text-body", focusRing, className)}
      {...props}
    />
  );
});
