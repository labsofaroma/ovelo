"use client";

import { Radio } from "@base-ui/react/radio";
import { RadioGroup as BaseRadioGroup } from "@base-ui/react/radio-group";
import { forwardRef, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { type PartProps } from "../../lib/types";
import { disabledStyles, focusRing } from "../../lib/styles";

export const RadioGroup = forwardRef<
  HTMLDivElement,
  PartProps<typeof BaseRadioGroup>
>(function RadioGroup({ className, ...props }, ref) {
  return (
    <BaseRadioGroup
      ref={ref}
      className={cn("flex flex-col gap-3", className)}
      {...props}
    />
  );
});

export interface RadioProps extends PartProps<typeof Radio.Root> {
  label: ReactNode;
}

/** One option in a <RadioGroup>. Arrow keys move and select; Tab leaves the group. */
export const RadioGroupItem = forwardRef<HTMLElement, RadioProps>(
  function RadioGroupItem({ label, className, ...props }, ref) {
    return (
      <label
        className={cn(
          "inline-flex cursor-pointer items-center gap-3 text-small text-ink",
          className,
        )}
      >
        <Radio.Root
          ref={ref}
          className={cn(
            "inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border-strong bg-surface transition-colors motion-fast",
            "data-[checked]:border-accent",
            focusRing,
            disabledStyles,
          )}
          {...props}
        >
          <Radio.Indicator className="size-2.5 rounded-full bg-accent data-[unchecked]:hidden" />
        </Radio.Root>
        <span>{label}</span>
      </label>
    );
  },
);
