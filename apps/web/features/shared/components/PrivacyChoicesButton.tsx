"use client";

import { SlidersHorizontal } from "lucide-react";
import { cn } from "@ovelo/ui";
import { textLink } from "../styles";

/** Opens the consent banner (features/shared/components/ConsentBanner listens for this event). */
export const OPEN_PRIVACY_EVENT = "ovelo:privacy-open";

/** Default look: an inline text link. Pass `className` (e.g. `linkButton.secondary`) to restyle. */
export function PrivacyChoicesButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_PRIVACY_EVENT))}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5",
        className ?? textLink,
      )}
    >
      <SlidersHorizontal aria-hidden="true" className="size-3.5" />
      Privacy choices
    </button>
  );
}
