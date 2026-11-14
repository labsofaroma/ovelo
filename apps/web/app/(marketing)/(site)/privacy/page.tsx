import type { Metadata } from "next";
import { LegalPage } from "@/features/marketing/components/LegalPage";
import { privacyDocument } from "@/features/marketing/content/privacy";
import { siteContact } from "@/features/marketing/site";
import { v1Metadata } from "@/features/shared/metadata";
import { routes } from "@/features/shared/routes";

// M4: rendered per request, like every v1 page: the strict CSP nonce is per request, and a
// prerendered page would carry no nonce, so its scripts (theme, Next runtime) would be blocked.
export const dynamic = "force-dynamic";

export const metadata: Metadata = v1Metadata({
  title: privacyDocument.title,
  description: privacyDocument.description,
  path: routes.privacy,
});

export default function PrivacyPage() {
  return <LegalPage document={privacyDocument} contact={siteContact()} />;
}
