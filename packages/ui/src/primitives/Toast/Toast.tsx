"use client";

import { Toast as BaseToast } from "@base-ui/react/toast";
import { X } from "lucide-react";
import { type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { focusRing } from "../../lib/styles";

export type ToastTone = "neutral" | "success" | "error" | "warning";

const TONES: Record<ToastTone, string> = {
  neutral: "border-line",
  success: "border-up",
  error: "border-down",
  warning: "border-warning",
};

/** Mount once near the app root. Toasts are announced politely (errors assertively). */
export function ToastProvider({
  children,
  timeout = 5000,
}: {
  children: ReactNode;
  timeout?: number;
}) {
  return (
    <BaseToast.Provider timeout={timeout}>
      {children}
      <ToastViewport />
    </BaseToast.Provider>
  );
}

/** `useToast().add({ title, description, type: "error" | "success" | ... })` */
export const useToast = BaseToast.useToastManager;

function ToastList() {
  const { toasts } = BaseToast.useToastManager();
  return toasts.map((toast) => (
    <BaseToast.Root
      key={toast.id}
      toast={toast}
      className={cn(
        "relative flex w-full items-start gap-3 rounded-panel border bg-surface p-4 pr-12 text-ink shadow-float transition-[opacity,transform] motion-pop",
        "data-[starting-style]:translate-y-2 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
        TONES[(toast.type as ToastTone | undefined) ?? "neutral"] ??
          TONES.neutral,
      )}
    >
      <BaseToast.Content className="flex min-w-0 flex-col gap-1">
        <BaseToast.Title className="text-small font-semibold" />
        <BaseToast.Description className="text-caption text-muted" />
      </BaseToast.Content>
      <BaseToast.Close
        aria-label="Dismiss notification"
        className={cn(
          "absolute right-2 top-2 inline-flex size-8 cursor-pointer items-center justify-center rounded-control text-muted hover:bg-raised hover:text-ink",
          focusRing,
        )}
      >
        <X size={16} aria-hidden="true" />
      </BaseToast.Close>
    </BaseToast.Root>
  ));
}

function ToastViewport() {
  return (
    <BaseToast.Portal>
      <BaseToast.Viewport className="fixed bottom-4 right-4 z-toast flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3 outline-none">
        <ToastList />
      </BaseToast.Viewport>
    </BaseToast.Portal>
  );
}
