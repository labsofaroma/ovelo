import "server-only";
import { expectedOrigin } from "@/features/creators/http";
import { isV1Enabled } from "@/server/env";
import { AppError } from "@/server/errors";
import { errorResponse } from "@/server/http";
import { actionHeaders } from "./actions-headers";

/**
 * HTTP plumbing for /api/v1/actions/* (M5b B4): the v1 gate, the Actions spec headers on every
 * response (errors included, so Blink clients can read the `message`), and `{ code, message }`
 * error bodies via mapError. Middleware adds the CORS headers and the trade rate-limit bucket.
 */

/** Where Action links point: the canonical site, else the origin the client used. */
export const actionOrigin = expectedOrigin;

type Handler<C> = (request: Request, context: C) => Promise<Response>;

export function actionRoute<C>(route: string, handler: Handler<C>): Handler<C> {
  return async (request, context) => {
    let response: Response;
    try {
      if (!isV1Enabled())
        throw new AppError("NOT_FOUND", { detail: "v1 disabled" });
      response = await handler(request, context);
    } catch (error) {
      response = errorResponse(error, { route });
    }
    for (const [key, value] of Object.entries(actionHeaders()))
      response.headers.set(key, value);
    return response;
  };
}

export function actionOptions(): Response {
  return new Response(null, { status: 204, headers: actionHeaders() });
}
