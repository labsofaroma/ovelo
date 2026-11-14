import { formatDay } from "../../shared/freshness";
import { pageContainer, textLink } from "../../shared/styles";
import type { LegalDocument } from "../schema";
import type { SiteContact } from "../site";

/**
 * Port of the prototype's LegalPage.tsx (deferred from M1). Presentation of a validated
 * LegalDocument; the shared v1 header/footer come from the layout. RSC, no client code.
 */
export function LegalPage({
  document,
  contact,
}: {
  document: LegalDocument;
  contact: SiteContact;
}) {
  return (
    <main id="main-content" className={`${pageContainer} py-10`}>
      <div className="flex max-w-3xl flex-col gap-6">
        <header className="flex flex-col gap-3">
          <p className="text-caption font-semibold uppercase tracking-wide text-muted">
            Aroma / your information
          </p>
          <h1 className="text-page font-semibold max-md:text-page-mobile">
            {document.title}
          </h1>
          <p className="text-title text-muted">{document.introduction}</p>
          <p className="text-small text-muted">
            Updated{" "}
            <time dateTime={document.updated}>
              {formatDay(document.updated)}
            </time>
          </p>
        </header>
        {document.sections.map((section) => (
          <section key={section.heading} className="flex flex-col gap-2">
            <h2 className="text-section font-semibold">{section.heading}</h2>
            {section.paragraphs.map((paragraph) => (
              <p
                key={paragraph.slice(0, 40)}
                className="text-body leading-relaxed"
              >
                {paragraph.replaceAll("{operator}", contact.operatorName)}
              </p>
            ))}
          </section>
        ))}
        <section className="flex flex-col gap-2">
          <h2 className="text-section font-semibold">Contact</h2>
          <p className="text-body">
            {contact.supportEmail ? (
              <a className={textLink} href={`mailto:${contact.supportEmail}`}>
                {contact.supportEmail}
              </a>
            ) : contact.issuesUrl ? (
              <>
                Reach the maintainers through{" "}
                <a className={textLink} href={contact.issuesUrl}>
                  Aroma’s project support
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
    </main>
  );
}
