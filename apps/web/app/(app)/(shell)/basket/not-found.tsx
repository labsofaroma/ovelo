import Link from "next/link";
import { Section, Stack } from "@ovelo/ui";
import { routes } from "@/features/shared/routes";
import { linkButton, pageContainer } from "@/features/shared/styles";

export default function BasketNotFound() {
  return (
    <main id="main-content" className={`${pageContainer} py-6 md:py-8`}>
      <Stack>
        <Section
          variant="hero"
          headingLevel="h1"
          title="Basket not found"
          description="No published basket has this id. It may have been retired or the link may be mistyped."
          actions={
            <Link className={linkButton.pill} href={routes.baskets}>
              See all baskets
            </Link>
          }
        />
      </Stack>
    </main>
  );
}
