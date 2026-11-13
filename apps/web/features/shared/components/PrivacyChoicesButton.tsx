"use client";

import { SlidersHorizontal } from "lucide-react";

/**
 * Opens the consent banner. Consent state still lives in the prototype's global PrivacyChoices
 * (root layout) until M7; this sends the same event it listens for, so v1 does not import legacy
 * code. Replace with features/account at cutover.
 */
export const OPEN_PRIVACY_EVENT = "aroma:privacy-open";

export function PrivacyChoicesButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_PRIVACY_EVENT))}
      className="inline-flex items-center gap-1 rounded-badge text-ink underline underline-offset-2 hover:text-accent focus-ring"
    >
      <SlidersHorizontal aria-hidden="true" className="size-3.5" />
      Privacy choices
    </button>
  );
}
