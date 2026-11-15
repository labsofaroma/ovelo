import "server-only";
import type { z } from "zod";
import { AppError, mapError } from "./errors";
import { logger } from "./logger";
import { requestHost, requestProtocol } from "./proxy";

const DEFAULT_MAX_BYTES = 16_384;

/**
 * Read a JSON body with a hard byte cap. Streamed bytes are counted as well as Content-Length,
 * so chunked bodies cannot bypass the limit. Ported from the prototype's request-policy.ts.
 * Throws AppError (PAYLOAD_TOO_LARGE, BAD_REQUEST, INVALID_JSON); never a raw parser error.
 */
export async function readLimitedJson(
  request: Request,
  maxBytes: number = DEFAULT_MAX_BYTES,
): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new AppError("PAYLOAD_TOO_LARGE", {
      detail: `content-length ${declared} > ${maxBytes}`,
    });
  }
  if (!request.body) {
    throw new AppError("BAD_REQUEST", {
      publicMessage: "A JSON request body is required.",
      detail: "missing body",
    });
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new AppError("PAYLOAD_TOO_LARGE", {
          detail: `streamed body exceeded ${maxBytes} bytes`,
        });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (cause) {
    throw new AppError("INVALID_JSON", { cause });
  }
}

/** Validate a value against a zod schema; throws AppError(VALIDATION_FAILED) naming bad fields only. */
export function parseValue<S extends z.ZodType>(
  schema: S,
  value: unknown,
): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw result.error;
  }
  return result.data;
}

/**
 * `parse(schema)` returns a request reader: bounded JSON read, then zod validation.
 * Handler shape: `const input = await parse(schema)(request)` → service call → mapError().
 */
export function parse<S extends z.ZodType>(
  schema: S,
  options: { maxBytes?: number } = {},
): (request: Request) => Promise<z.output<S>> {
  return async (request) =>
    parseValue(schema, await readLimitedJson(request, options.maxBytes));
}

/** Log the real error, return a client-safe JSON response `{ code, message }` (AUDIT M-5). */
export function errorResponse(
  error: unknown,
  context: Record<string, unknown> = {},
): Response {
  const { status, body } = mapError(error);
  if (status >= 500)
    logger.error({ err: error, code: body.code, ...context }, "request failed");
  else
    logger.info(
      {
        code: body.code,
        detail: error instanceof AppError ? error.detail : undefined,
        ...context,
      },
      "request rejected",
    );
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * AUDIT M-6: a state-changing /api/v1 request that carries an `Origin` must come from this site
 * (its own origin, OVELO_SITE_URL, or an exact entry of OVELO_ALLOWED_ORIGINS). A request with
 * no Origin (a native app, a server) is allowed here only because every such route ALSO needs a
 * signature, an HMAC token or a bearer secret.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const url = new URL(request.url);
  // `request.url` can carry the server's own hostname (e.g. localhost under `next start`), so the
  // origin the browser actually used is rebuilt from the one header parser (server/proxy.ts),
  // exactly as middleware.ts does.
  const host = requestHost(request.headers, "", process.env);
  const protocol = requestProtocol(request.headers, url.protocol, process.env);
  const allowed = new Set(
    [
      url.origin,
      host ? `${protocol}://${host}` : undefined,
      process.env.OVELO_SITE_URL,
      ...(process.env.OVELO_ALLOWED_ORIGINS ?? "").split(","),
    ]
      .map((value) => value?.trim().replace(/\/$/, ""))
      .filter((value): value is string => Boolean(value)),
  );
  if (!allowed.has(origin.replace(/\/$/, "")))
    throw new AppError("ORIGIN_FORBIDDEN", { detail: "cross-origin request" });
}
