import { forwardRef, type LabelHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  /** Adds a visible asterisk (hidden from screen readers; put `required` on the control). */
  required?: boolean;
}

export const Label = forwardRef<HTMLLabelElement, LabelProps>(function Label(
  { required, className, children, ...props },
  ref,
) {
  return (
    <label
      ref={ref}
      className={cn("text-small font-semibold text-ink", className)}
      {...props}
    >
      {children}
      {required && (
        <span aria-hidden="true" className="ml-0.5 text-down">
          *
        </span>
      )}
    </label>
  );
});
