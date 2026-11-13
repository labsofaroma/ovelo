import type { GlobalProvider } from "@ladle/react";
import "./styles.css";

/** Tooltips need their provider; everything else is self-contained. */
export const Provider: GlobalProvider = ({ children }) => (
  <div className="p-6 font-sans text-body text-ink">{children}</div>
);
