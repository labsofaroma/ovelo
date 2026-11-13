import "server-only";
import pino, {
  type DestinationStream,
  type Logger,
  type LoggerOptions,
} from "pino";
import {
  isSensitiveKey,
  REDACTED,
  scrubDeep,
  scrubSecretText,
  SENSITIVE_KEYS,
} from "@/observability/scrub";

export { REDACTED };

/**
 * Deep-scrub a log payload: sensitive keys, bearer tokens, credentialed URLs, key=value secrets
 * and 64-byte keypairs (as arrays, JSON or hex). Defence in depth on top of pino's path
 * redaction, since a secret can arrive under an arbitrary key. Wallet addresses are kept in
 * logs (they are needed to debug); they are stripped only from Sentry events.
 */
export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[Truncated]";
  if (value instanceof Error) return serializeError(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    // Errors nested inside objects are serialised too.
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = isSensitiveKey(key)
        ? REDACTED
        : item instanceof Error
          ? serializeError(item)
          : scrub(item, depth + 1);
    }
    return out;
  }
  return scrubDeep(value, scrubSecretText, depth);
}

function serializeError(error: Error): Record<string, unknown> {
  return {
    type: error.name,
    message: scrubSecretText(error.message),
    stack: error.stack ? scrubSecretText(error.stack) : undefined,
  };
}

export function createLogger(
  options: { level?: string; destination?: DestinationStream } = {},
): Logger {
  const config: LoggerOptions = {
    level: options.level ?? process.env.LOG_LEVEL ?? "info",
    base: { service: "aroma-web" },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: SENSITIVE_KEYS.flatMap((key) => [
        key,
        `*.${key}`,
        `*.headers.${key}`,
        `headers.${key}`,
      ]),
      censor: REDACTED,
    },
    serializers: { err: serializeError, error: serializeError },
    formatters: {
      level: (label) => ({ level: label }),
      log: (object) => scrub(object) as Record<string, unknown>,
    },
    hooks: {
      // Message strings can carry secrets too (e.g. an error message with a URL).
      logMethod(args, method) {
        const [first, ...rest] = args as unknown as [unknown, ...unknown[]];
        const scrubbed =
          typeof first === "string" ? scrubSecretText(first) : first;
        const restScrubbed = rest.map((item) =>
          typeof item === "string" ? scrubSecretText(item) : item,
        );
        return method.apply(this, [
          scrubbed,
          ...restScrubbed,
        ] as unknown as Parameters<typeof method>);
      },
    },
  };
  return options.destination ? pino(config, options.destination) : pino(config);
}

/** Shared structured JSON logger. Never pass env values, keypairs or Authorization headers. */
export const logger: Logger = createLogger();
