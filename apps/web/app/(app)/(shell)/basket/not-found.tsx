import Link from "next/link";
import { routes } from "@/features/shared/routes";
import { pageContainer, textLink } from "@/features/shared/styles";

export default function BasketNotFound() {
  return (
    <main
      id="main-content"
      className={`${pageContainer} flex flex-col gap-4 py-12`}
    >
      <h1 className="text-page font-semibold max-md:text-page-mobile">
        Basket not found
      </h1>
      <p className="max-w-2xl text-body text-muted">
        No published basket has this id. It may have been retired or the link
        may be mistyped.
      </p>
      <Link className={textLink} href={routes.baskets}>
        See all baskets
      </Link>
    </main>
  );
}
