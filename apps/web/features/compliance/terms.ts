import { termsDocument } from "../marketing/content/terms";

/**
 * Terms versions a wallet can accept (M9 compliance gate, C3). Pure data: the server hashes the
 * canonical JSON of `document` (features/compliance/server/terms.ts) and the wallet signs that
 * version and hash. A new version (a counsel edit) is added here and selected with
 * AROMA_TERMS_VERSION; every wallet then re-accepts before its next quote.
 *
 * NEEDS COUNSEL'S FINAL TEXT: the only version today is the prototype's terms page, ported
 * unchanged. It is a placeholder for acceptance purposes (`final: false`), not counsel's text.
 */
export type TermsVersion = {
  version: string;
  /** False until counsel supplies the final text (COMPLIANCE.md §4). */
  final: boolean;
  document: {
    title: string;
    updated: string;
    sections: readonly { heading: string; paragraphs: readonly string[] }[];
  };
};

export const TERMS_VERSIONS: readonly TermsVersion[] = [
  {
    version: "2026-09-13-placeholder",
    final: false,
    document: {
      title: termsDocument.title,
      updated: termsDocument.updated,
      sections: termsDocument.sections,
    },
  },
];

export const CURRENT_TERMS_VERSION = TERMS_VERSIONS.at(-1)!.version;

export function termsVersion(version: string): TermsVersion | undefined {
  return TERMS_VERSIONS.find((t) => t.version === version);
}
