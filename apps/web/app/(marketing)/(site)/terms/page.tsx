import type { Metadata } from "next";
import { LegalPage } from "@/features/marketing/components/LegalPage";
import { termsDocument } from "@/features/marketing/content/terms";
import { siteContact } from "@/features/marketing/site";
import { v1Metadata } from "@/features/shared/metadata";
import { routes } from "@/features/shared/routes";
import { assertV1Enabled } from "@/features/shared/v1";

// M4: rendered per request, like every v1 page: the strict CSP nonce is per request, and a
// prerendered page would carry no nonce, so its scripts (theme, Next runtime) would be blocked.
export const dynamic = "force-dynamic";

export const metadata: Metadata = v1Metadata({
  title: termsDocument.title,
  description: termsDocument.description,
  path: routes.terms,
});

export default function TermsPage() {
  assertV1Enabled();
  return <LegalPage document={termsDocument} contact={siteContact()} />;
}
