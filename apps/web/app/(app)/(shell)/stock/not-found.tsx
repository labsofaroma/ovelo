import Link from "next/link";
import { Section } from "@ovelo/ui";
import { routes } from "@/features/shared/routes";
import { linkButton, pageContainer } from "@/features/shared/styles";

export default function StockNotFound() {
  return (
    <main id="main-content" className={`${pageContainer} py-6 md:py-8`}>
      <Section
        variant="hero"
        headingLevel="h1"
        title="Stock not found"
        description="No issuer catalog lists this symbol or mint. It may have been delisted, or the link may be mistyped."
        actions={
          <Link className={linkButton.pill} href={routes.markets}>
            Browse all markets
          </Link>
        }
      />
    </main>
  );
}
