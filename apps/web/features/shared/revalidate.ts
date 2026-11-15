import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/server/errors";

/** Tags a caller may refresh. Anything else is rejected, so the route cannot flush arbitrary data. */
export const revalidateBodySchema = z.object({
  tags: z
    .array(
      z
        .string()
        .regex(/^v1:(markets|research)(:[1-9A-HJ-NP-Za-km-z]{32,44})?$/)
        .refine(
          (tag) => !tag.startsWith("v1:markets:"),
          "markets has no sub-tags",
        ),
    )
    .min(1)
    .max(20),
});

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Bearer check for POST /api/v1/revalidate (AGENTS.md rule 2). Constant-time over SHA-256
 * digests, so neither content nor length leaks through timing. Fails closed when unconfigured.
 */
export function assertRevalidateAuthorized(
  authorization: string | null,
  secret: string | undefined,
): void {
  if (!secret)
    throw new AppError("SERVICE_UNAVAILABLE", {
      detail: "OVELO_REVALIDATE_SECRET is not set",
    });
  const match = /^Bearer (\S+)$/.exec(authorization ?? "");
  if (!match?.[1] || !timingSafeEqual(digest(match[1]), digest(secret)))
    throw new AppError("UNAUTHORIZED");
}
