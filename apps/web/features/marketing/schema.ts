import { z } from "zod";

/** Legal pages are data: validated at import (tests) so a malformed edit fails CI, not the page. */
export const legalDocumentSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1).max(200),
  introduction: z.string().min(1),
  /** ISO date the text last changed. Displayed; never "today". */
  updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sections: z
    .array(
      z.object({
        heading: z.string().min(1),
        paragraphs: z.array(z.string().min(1)).min(1),
      }),
    )
    .min(1),
});
export type LegalDocument = z.infer<typeof legalDocumentSchema>;
