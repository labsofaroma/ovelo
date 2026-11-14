import "server-only";
import { expectedOrigin } from "@/features/creators/http";
import { isV1Enabled } from "@/server/env";
import { AppError } from "@/server/errors";
import { errorResponse } from "@/server/http";

/** Thin-handler plumbing for /api/v1/compliance/*: the v1 gate, then `{ code, message }` errors. */
export function complianceRoute(
  route: string,
  handler: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      if (!isV1Enabled())
        throw new AppError("NOT_FOUND", { detail: "v1 disabled" });
      return await handler(request);
    } catch (error) {
      return errorResponse(error, { route });
    }
  };
}

export const termsOrigin = expectedOrigin;
export const noStore = { "Cache-Control": "no-store" } as const;
