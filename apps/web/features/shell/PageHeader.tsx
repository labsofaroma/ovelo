import type { ReactNode } from "react";
import { GradientHeading } from "@ovelo/ui";

/** The opening line of a page: eyebrow pill, silver headline, one sentence, actions. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 py-2 md:flex-row md:items-end md:justify-between md:py-4">
      <div className="flex max-w-3xl flex-col gap-3">
        {eyebrow && (
          <span className="inline-flex w-fit items-center rounded-full border border-line bg-raised-2 px-3 py-1 text-caption font-medium text-ink">
            {eyebrow}
          </span>
        )}
        <GradientHeading as="h1" size="page">
          {title}
        </GradientHeading>
        {description && (
          <p className="text-body leading-body text-muted">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
