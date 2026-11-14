import type { Logger } from "./log";
import { SignatureError, verifyQStashSignature } from "./qstash";

/**
 * The stateless HTTP surface: `POST /run` (QStash-signed, current or next key) and `GET /health`.
 * Built on the fetch Request/Response types, so it runs under node:http (server.ts), a serverless
 * runtime or a test without a socket.
 */

export const MAX_BODY_BYTES = 16_384;

export type HandlerDeps = {
  log: Logger;
  cluster: string;
  currentKey: string;
  nextKey: string;
  /** The URL QStash calls; when unset, the request's own URL is used for the `sub` check. */
  publicUrl?: string;
  run(): Promise<unknown>;
  now?: () => number;
};

const json = (body: unknown, status = 200) =>
  new Response(
    JSON.stringify(body, (_k, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    },
  );

let running = false;

export function createHandler(
  deps: HandlerDeps,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health")
      return json({ ok: true, cluster: deps.cluster });
    if (url.pathname !== "/run")
      return json({ code: "NOT_FOUND", message: "Not found." }, 404);
    if (request.method !== "POST")
      return json({ code: "METHOD_NOT_ALLOWED", message: "Use POST." }, 405);
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > MAX_BODY_BYTES)
      return json(
        { code: "PAYLOAD_TOO_LARGE", message: "Body too large." },
        413,
      );
    const body = await request.text();
    if (body.length > MAX_BODY_BYTES)
      return json(
        { code: "PAYLOAD_TOO_LARGE", message: "Body too large." },
        413,
      );
    try {
      verifyQStashSignature({
        signature: request.headers.get("upstash-signature"),
        body,
        currentKey: deps.currentKey,
        nextKey: deps.nextKey,
        url: deps.publicUrl ?? `${url.origin}${url.pathname}`,
        now: deps.now?.(),
      });
    } catch (error) {
      deps.log.warn(
        { reason: error instanceof SignatureError ? error.reason : "unknown" },
        "keeper call refused: bad QStash signature",
      );
      return json(
        {
          code: "UNAUTHORIZED",
          message: "A valid QStash signature is required.",
        },
        401,
      );
    }
    // One run at a time per instance; QStash retries a 409 later. Leases cover several instances.
    if (running)
      return json(
        { code: "CONFLICT", message: "A run is already in progress." },
        409,
      );
    running = true;
    try {
      return json(await deps.run());
    } catch (error) {
      deps.log.error({ err: error }, "keeper run failed");
      return json(
        {
          code: "RUN_FAILED",
          message: "The keeper run failed; see the keeper logs.",
        },
        500,
      );
    } finally {
      running = false;
    }
  };
}
