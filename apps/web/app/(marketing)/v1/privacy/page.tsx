import type { Metadata } from "next";
import { LegalPage } from "@/features/marketing/components/LegalPage";
import { privacyDocument } from "@/features/marketing/content/privacy";
import { siteContact } from "@/features/marketing/site";
import { v1Metadata } from "@/features/shared/metadata";
import { routes } from "@/features/shared/routes";
import { assertV1Enabled } from "@/features/shared/v1";

export const dynamic = "force-static";

export const metadata: Metadata = v1Metadata({
  title: privacyDocument.title,
  description: privacyDocument.description,
  path: routes.privacy,
});

export default function PrivacyPage() {
  assertV1Enabled();
  return <LegalPage document={privacyDocument} contact={siteContact()} />;
}
