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
      className={cn(
        "relative isolate inline-flex max-w-full gap-1 overflow-x-auto rounded-full border border-line bg-raised p-1",
        className,
      )}
      {...props}
    >
      <BaseTabs.Indicator className="absolute top-1 bottom-1 left-(--active-tab-left) -z-10 w-(--active-tab-width) rounded-full bg-raised-2 edge-highlight transition-[left,width] motion-base" />
      {children}
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
        "min-h-9 shrink-0 cursor-pointer whitespace-nowrap rounded-full px-4 text-small font-medium text-muted transition-colors motion-base hover:text-ink max-md:min-h-(--ovelo-control-height)",
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
      className={cn("pt-5 text-body", focusRing, className)}
      {...props}
    />
  );
});
