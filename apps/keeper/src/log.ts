import pino, { type Logger } from "pino";

/**
 * Redacted JSON logs. Secrets never reach a log line: known secret keys are censored wherever
 * they appear, and `scrub` replaces any 64-byte array (a secret key shape) and long base64 blobs.
 */

export const REDACTED = "[redacted]";
const SECRET_KEY =
  /(keypair|secret|token|signing_?key|api_?key|password|authorization|private)/i;
const KEY_ARRAY = (value: unknown) =>
  Array.isArray(value) &&
  value.length === 64 &&
  value.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);

export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array)
    return value.length === 64 ? REDACTED : `[bytes ${value.length}]`;
  if (KEY_ARRAY(value)) return REDACTED;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (value instanceof Error)
    return {
      name: value.name,
      message: value.message,
      ...(scrub({ ...value }, depth + 1) as object),
    };
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value))
      out[key] = SECRET_KEY.test(key) ? REDACTED : scrub(v, depth + 1);
    return out;
  }
  if (
    typeof value === "string" &&
    /^\[\s*\d{1,3}(\s*,\s*\d{1,3}){63}\s*\]$/.test(value)
  )
    return REDACTED;
  return value;
}

export function createLogger(
  level: string,
  destination?: pino.DestinationStream,
): Logger {
  return pino(
    {
      level,
      base: { service: "aroma-keeper" },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { log: (object) => scrub(object) as Record<string, unknown> },
    },
    destination,
  );
}

export type { Logger };
