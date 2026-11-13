import type { Metadata } from "next";
import NotFound from "./(prototype)/not-found";
import "./(prototype)/globals.css";

/**
 * Unmatched URLs (M4). With three root layouts there is no top-level layout to wrap a 404, so
 * Next renders this document (experimental.globalNotFound). It keeps the prototype's 404 page,
 * which is what every unknown URL showed before the split. M7 replaces it with the v1 design.
 */
export const metadata: Metadata = {
  title: "Page not found | Aroma",
  robots: { index: false, follow: false },
};

export default function GlobalNotFound() {
  return (
    <html lang="en" data-theme="dark">
      <body>
        <NotFound />
      </body>
    </html>
  );
}
