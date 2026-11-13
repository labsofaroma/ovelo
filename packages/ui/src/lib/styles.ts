/** Class recipes shared by several primitives. Tokens only: no raw colors. */

/** Visible focus ring for every interactive primitive (see `focus-ring` in theme.css). */
export const focusRing = "focus-ring";

/** Boundary, surface and sizing shared by text-like controls. */
export const controlSurface =
  "min-h-(--aroma-control-height) rounded-control border border-border-strong bg-surface text-ink text-small";

export const disabledStyles =
  "disabled:cursor-not-allowed disabled:opacity-50 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50";

/** Popup chrome for menus, popovers, selects and tooltips. */
export const popupSurface =
  "rounded-control border border-line bg-surface text-ink shadow-float outline-none";

/** Enter/exit transition driven by Base UI's data attributes; collapses with reduced motion. */
export const popupMotion =
  "transition-[opacity,transform] motion-pop data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:scale-95";
