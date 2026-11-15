import { GradientHeading } from "@ovelo/ui";
import { formatDay } from "../../shared/freshness";
import { eyebrowPill, pageContainer, textLink } from "../../shared/styles";
import type { LegalDocument } from "../schema";
import type { SiteContact } from "../site";

/**
 * Port of the prototype's LegalPage.tsx (deferred from M1). Presentation of a validated
 * LegalDocument in one reading card; the shared v1 header/footer come from the layout. RSC, no
 * client code.
 */
export function LegalPage({
  document,
  contact,
}: {
  document: LegalDocument;
  contact: SiteContact;
}) {
  return (
    <main id="main-content" className={`${pageContainer} pt-4 pb-6 md:pt-10`}>
      <article className="mx-auto flex w-full max-w-4xl flex-col gap-10 rounded-[1.75rem] border border-line bg-surface px-6 py-10 edge-highlight md:rounded-hero md:px-16 md:py-16">
        <header className="flex max-w-[68ch] flex-col gap-4">
          <p className={eyebrowPill}>Ovelo · your information</p>
          <GradientHeading as="h1" size="page">
            {document.title}
          </GradientHeading>
          <p className="text-body leading-body text-muted md:text-title md:leading-snug">
            {document.introduction}
          </p>
          <p className="text-caption text-muted">
            Updated{" "}
            <time dateTime={document.updated}>
              {formatDay(document.updated)}
            </time>
          </p>
        </header>
        <div className="h-px w-full bg-line" aria-hidden="true" />
        <div className="flex max-w-[68ch] flex-col gap-10">
          {document.sections.map((section) => (
            <section key={section.heading} className="flex flex-col gap-3">
              <h2 className="font-display text-title font-medium tracking-[-0.02em] text-ink">
                {section.heading}
              </h2>
              {section.paragraphs.map((paragraph) => (
                <p
                  key={paragraph.slice(0, 40)}
                  className="text-body leading-[1.75] text-muted"
                >
                  {paragraph.replaceAll("{operator}", contact.operatorName)}
                </p>
              ))}
            </section>
          ))}
          <section className="flex flex-col gap-3">
            <h2 className="font-display text-title font-medium tracking-[-0.02em] text-ink">
              Contact
            </h2>
            <p className="text-body leading-[1.75] text-muted">
              {contact.supportEmail ? (
                <a className={textLink} href={`mailto:${contact.supportEmail}`}>
                  {contact.supportEmail}
                </a>
              ) : contact.issuesUrl ? (
                <>
                  Reach the maintainers through{" "}
                  <a className={textLink} href={contact.issuesUrl}>
                    Ovelo’s project support
                  </a>
                  . Public issues are visible to everyone; do not post personal
                  information, private keys or account credentials.
                </>
              ) : (
                "Contact details have not been configured for this deployment."
              )}
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}
