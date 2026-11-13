import Link from "next/link";
import { routes } from "@/features/shared/routes";
import { pageContainer, textLink } from "@/features/shared/styles";

export default function StockNotFound() {
  return (
    <main id="main-content" className={`${pageContainer} flex flex-col gap-4 py-12`}>
      <h1 className="text-page font-semibold max-md:text-page-mobile">Stock not found</h1>
      <p className="max-w-2xl text-body text-muted">
        No issuer catalog lists this symbol or mint. It may have been delisted, or the
        link may be mistyped.
      </p>
      <Link className={textLink} href={routes.markets}>
        Browse all markets
      </Link>
    </main>
  );
}
