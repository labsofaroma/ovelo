import "server-only";
import { expectedOrigin } from "@/features/creators/http";
import { AppError } from "@/server/errors";
import { errorResponse } from "@/server/http";
import { timingSafeEqual } from "node:crypto";
import type { NotifyDeps } from "./deps";

/** Thin-handler plumbing for /api/v1/notifications/*: `{ code, message }` errors, no caching. */
export function notifyRoute<A extends unknown[]>(
  route: string,
  handler: (request: Request, ...rest: A) => Promise<Response>,
): (request: Request, ...rest: A) => Promise<Response> {
  return async (request, ...rest) => {
    try {
      return await handler(request, ...rest);
    } catch (error) {
      return errorResponse(error, { route });
    }
  };
}

export const notifyOrigin = expectedOrigin;
export const noStore = { "Cache-Control": "no-store" } as const;

/** The worker route's bearer secret (QStash `Upstash-Forward-Authorization`, or a cron). */
export function assertWorkerSecret(
  deps: NotifyDeps,
  header: string | null,
): void {
  const secret = deps.config().workerSecret;
  const given = Buffer.from(header ?? "");
  const want = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret)
    throw new AppError("SERVICE_UNAVAILABLE", {
      detail: "worker secret not set",
    });
  if (given.length !== want.length || !timingSafeEqual(given, want))
    throw new AppError("UNAUTHORIZED", { detail: "worker secret" });
}
