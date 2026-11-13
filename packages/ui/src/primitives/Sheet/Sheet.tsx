"use client";

import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { forwardRef, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { type PartProps } from "../../lib/types";
import { focusRing } from "../../lib/styles";
import { DialogDescription, DialogTitle } from "../Dialog";

export type SheetSide = "right" | "left" | "bottom";

export const Sheet = BaseDialog.Root;
export const SheetTrigger = BaseDialog.Trigger;
export const SheetClose = BaseDialog.Close;
export const SheetTitle = DialogTitle;
export const SheetDescription = DialogDescription;

const SIDES: Record<SheetSide, string> = {
  right:
    "inset-y-0 right-0 h-full w-[min(26rem,100%)] border-l data-[starting-style]:translate-x-full data-[ending-style]:translate-x-full",
  left: "inset-y-0 left-0 h-full w-[min(26rem,100%)] border-r data-[starting-style]:-translate-x-full data-[ending-style]:-translate-x-full",
  bottom:
    "inset-x-0 bottom-0 max-h-[85dvh] w-full rounded-t-panel border-t data-[starting-style]:translate-y-full data-[ending-style]:translate-y-full",
};

export interface SheetContentProps extends PartProps<typeof BaseDialog.Popup> {
  side?: SheetSide;
  closeLabel?: string;
  children: ReactNode;
}

/** Edge-anchored modal panel (drawer). Same modal semantics as Dialog; slides in from `side`. */
export const SheetContent = forwardRef<HTMLDivElement, SheetContentProps>(
  function SheetContent(
    { side = "right", className, children, closeLabel = "Close", ...props },
    ref,
  ) {
    return (
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-overlay bg-scrim transition-opacity motion-slow data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
        <BaseDialog.Popup
          ref={ref}
          className={cn(
            "fixed z-modal overflow-y-auto border-line bg-surface p-6 text-ink shadow-float outline-none transition-transform motion-slow",
            SIDES[side],
            className,
          )}
          {...props}
        >
          {children}
          <BaseDialog.Close
            aria-label={closeLabel}
            className={cn(
              "absolute right-3 top-3 inline-flex size-9 cursor-pointer items-center justify-center rounded-control text-muted hover:bg-raised hover:text-ink",
              focusRing,
            )}
          >
            <X size={18} aria-hidden="true" />
          </BaseDialog.Close>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    );
  },
);
