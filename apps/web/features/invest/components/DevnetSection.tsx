import { Section } from "@ovelo/ui";
import type { ReactNode } from "react";
import { investCopy } from "../copy";

/** The card that opens the devnet half of /invest: its heading, the test label and wallet actions. */
export function DevnetSection({
  actions,
  children,
}: {
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Section
      eyebrow="Devnet test"
      title={investCopy.devnetHeading}
      description={investCopy.devnetLabel}
      actions={actions}
    >
      {children}
    </Section>
  );
}
