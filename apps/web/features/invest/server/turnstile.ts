import "server-only";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";

/**
 * Cloudflare Turnstile, verified server-side (siteverify). Locally and in tests the published
 * test keys are used (secret 1x0000000000000000000000000000000AA always passes, 2x… always
 * fails); production refuses them in the env schema. A failure is CAPTCHA_FAILED; Cloudflare
 * being unreachable is UPSTREAM_UNAVAILABLE. Both are logged, never swallowed.
 */

export const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileResult = {
  hostname: string | null;
  action: string | null;
};

export async function verifyTurnstile(input: {
  secret: string;
  token: string;
  remoteIp?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Promise<TurnstileResult> {
  const body = new URLSearchParams({
    secret: input.secret,
    response: input.token,
  });
  if (
    input.remoteIp &&
    input.remoteIp !== "local" &&
    input.remoteIp !== "unknown"
  )
    body.set("remoteip", input.remoteIp);
  let response: Response;
  try {
    response = await (input.fetch ?? fetch)(SITEVERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(input.timeoutMs ?? 8_000),
    });
  } catch (cause) {
    logger.error({ err: cause }, "turnstile siteverify unreachable");
    throw new AppError("UPSTREAM_UNAVAILABLE", {
      detail: "turnstile unreachable",
      cause,
    });
  }
  let parsed: {
    success?: unknown;
    "error-codes"?: unknown;
    hostname?: unknown;
    action?: unknown;
  };
  try {
    parsed = (await response.json()) as typeof parsed;
  } catch (cause) {
    logger.error(
      { status: response.status },
      "turnstile siteverify returned non-JSON",
    );
    throw new AppError("UPSTREAM_UNAVAILABLE", {
      detail: "turnstile malformed",
      cause,
    });
  }
  if (!response.ok || parsed.success !== true) {
    const codes = Array.isArray(parsed["error-codes"])
      ? parsed["error-codes"].map(String)
      : [];
    logger.info(
      { status: response.status, codes },
      "turnstile verification failed",
    );
    throw new AppError("CAPTCHA_FAILED", {
      detail: `turnstile: ${codes.join(",") || "not successful"}`,
    });
  }
  return {
    hostname: typeof parsed.hostname === "string" ? parsed.hostname : null,
    action: typeof parsed.action === "string" ? parsed.action : null,
  };
}
