"use client";

import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { forwardRef, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { type PartProps } from "../../lib/types";
import { focusRing } from "../../lib/styles";

export const Dialog = BaseDialog.Root;
export const DialogTrigger = BaseDialog.Trigger;
export const DialogClose = BaseDialog.Close;

export interface DialogContentProps extends PartProps<typeof BaseDialog.Popup> {
  /** Accessible name of the built-in close button. */
  closeLabel?: string;
  children: ReactNode;
}

/** Modal dialog: focus is trapped, Escape and backdrop click close it, focus returns to the trigger. */
export const DialogContent = forwardRef<HTMLDivElement, DialogContentProps>(
  function DialogContent(
    { className, children, closeLabel = "Close", ...props },
    ref,
  ) {
    return (
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-overlay bg-scrim transition-opacity motion-base data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
        <BaseDialog.Viewport className="fixed inset-0 z-modal grid place-items-center overflow-y-auto p-4">
          <BaseDialog.Popup
            ref={ref}
            className={cn(
              "relative w-full max-w-lg rounded-panel border border-line bg-surface p-6 text-ink shadow-float outline-none transition-[opacity,transform] motion-pop",
              "data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
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
        </BaseDialog.Viewport>
      </BaseDialog.Portal>
    );
  },
);

export const DialogTitle = forwardRef<
  HTMLHeadingElement,
  PartProps<typeof BaseDialog.Title>
>(function DialogTitle({ className, ...props }, ref) {
  return (
    <BaseDialog.Title
      ref={ref}
      className={cn(
        "pr-8 text-title font-medium tracking-[-0.03em]",
        className,
      )}
      {...props}
    />
  );
});

export const DialogDescription = forwardRef<
  HTMLParagraphElement,
  PartProps<typeof BaseDialog.Description>
>(function DialogDescription({ className, ...props }, ref) {
  return (
    <BaseDialog.Description
      ref={ref}
      className={cn("mt-2 text-small text-muted", className)}
      {...props}
    />
  );
});

export function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mt-6 flex flex-wrap justify-end gap-3", className)}
      {...props}
    />
  );
}
