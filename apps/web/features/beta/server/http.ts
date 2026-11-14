import "server-only";
import { expectedOrigin } from "@/features/creators/http";
import { errorResponse } from "@/server/http";

/** Thin-handler plumbing for /api/v1/beta/*: the v1 gate, then `{ code, message }` errors. */
export function betaRoute(
  route: string,
  handler: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      return await handler(request);
    } catch (error) {
      return errorResponse(error, { route });
    }
  };
}

export const betaOrigin = expectedOrigin;
export const noStore = { "Cache-Control": "no-store" } as const;
