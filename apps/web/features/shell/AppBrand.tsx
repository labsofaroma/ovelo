import Link from "next/link";
import { Brand } from "@ovelo/ui";
import { routes } from "../shared/routes";

/** The Ovelo lockup (glyph and wordmark), linking home. */
export function AppBrand({ variant }: { variant?: "horizontal" | "glyph" }) {
  return <Brand variant={variant} href={routes.home} LinkComponent={Link} />;
}
