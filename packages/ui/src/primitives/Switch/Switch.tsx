"use client";

import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { forwardRef, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { type PartProps } from "../../lib/types";
import { disabledStyles, focusRing } from "../../lib/styles";

export interface SwitchProps extends PartProps<typeof BaseSwitch.Root> {
  label?: ReactNode;
}

/** On/off setting that applies immediately. Use Checkbox for choices submitted with a form. */
export const Switch = forwardRef<HTMLElement, SwitchProps>(function Switch(
  { label, className, ...props },
  ref,
) {
  const control = (
    <BaseSwitch.Root
      ref={ref}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-border-strong bg-raised p-0.5 transition-colors motion-base",
        "data-[checked]:border-transparent data-[checked]:bg-accent",
        focusRing,
        disabledStyles,
        !label && className,
      )}
      {...props}
    >
      <BaseSwitch.Thumb className="block size-4.5 rounded-full bg-ink transition-transform motion-base data-[checked]:translate-x-5 data-[checked]:bg-accent-ink" />
    </BaseSwitch.Root>
  );
  if (!label) return control;
  return (
    <label
      className={cn(
        "inline-flex cursor-pointer items-center gap-3 text-small text-ink",
        className,
      )}
    >
      {control}
      <span>{label}</span>
    </label>
  );
});
