/**
 * Pure PII / secret scrubbing shared by the logger (server) and Sentry (client, server, edge).
 * No `server-only` import and no Node APIs, so it is safe in every runtime.
 */

export const REDACTED = "[REDACTED]";
export const WALLET_PLACEHOLDER = "[wallet]";

const B58 = "1-9A-HJ-NP-Za-km-z";
/** A base58 string of wallet/mint length that is not part of a longer token (signatures are 87-88). */
const WALLET_ADDRESS = new RegExp(
  `(?<![${B58}])[${B58}]{32,44}(?![${B58}])`,
  "g",
);
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi;
const INLINE_SECRET =
  /\b(password|passwd|secret|token|api[_-]?key|private[_-]?key)(=|:\s*)[^\s&,;"']+/gi;
const HEX_KEY = /^[0-9a-fA-F]{128}$/;
const BYTE_ARRAY_JSON = /^\s*\[\s*(?:\d{1,3}\s*,\s*){31,}\d{1,3}\s*\]\s*$/;

export const SENSITIVE_KEYS = [
  "authorization",
  "cookie",
  "set-cookie",
  "password",
  "secret",
  "token",
  "apikey",
  "api_key",
  "privatekey",
  "secretkey",
  "keypair",
  "mnemonic",
  "seed",
  "hmac",
  "databaseurl",
  "database_url",
] as const;

export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.some(
    (sensitive) => lower === sensitive || lower.endsWith(sensitive),
  );
}

/** Secrets inside free text: bearer tokens, credentialed URLs, key=value pairs, raw keypairs. */
export function scrubSecretText(value: string): string {
  if (HEX_KEY.test(value) || BYTE_ARRAY_JSON.test(value)) return REDACTED;
  return value
    .replace(BEARER, `Bearer ${REDACTED}`)
    .replace(URL_CREDENTIALS, `$1${REDACTED}@`)
    .replace(INLINE_SECRET, `$1$2${REDACTED}`);
}

/** Secrets plus wallet addresses. Used for telemetry that leaves the process (Sentry). */
export function scrubTelemetryText(value: string): string {
  return scrubSecretText(value).replace(WALLET_ADDRESS, WALLET_PLACEHOLDER);
}

/** Drop the query string (it can carry `?wallet=`), then scrub the rest. */
export function scrubUrl(value: string): string {
  const withoutQuery = value.split(/[?#]/)[0] ?? value;
  return scrubTelemetryText(withoutQuery);
}

function isByteArray(value: unknown[]): boolean {
  return (
    (value.length === 32 || value.length === 64) &&
    value.every(
      (item) =>
        Number.isInteger(item) &&
        (item as number) >= 0 &&
        (item as number) <= 255,
    )
  );
}

/** Deep-scrub arbitrary data. `text` decides how strings are treated. */
export function scrubDeep(
  value: unknown,
  text: (input: string) => string,
  depth = 0,
): unknown {
  if (depth > 8) return "[Truncated]";
  if (typeof value === "string") return text(value);
  if (Array.isArray(value)) {
    return isByteArray(value)
      ? REDACTED
      : value.map((item) => scrubDeep(item, text, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = isSensitiveKey(key)
        ? REDACTED
        : scrubDeep(item, text, depth + 1);
    }
    return out;
  }
  return value;
}

/** Minimal structural view of a Sentry event: enough to scrub without importing the SDK. */
export type ScrubbableEvent = {
  user?: unknown;
  server_name?: unknown;
  message?: string;
  transaction?: string;
  request?: {
    url?: string;
    query_string?: unknown;
    cookies?: unknown;
    headers?: unknown;
    data?: unknown;
  };
  exception?: { values?: Array<{ value?: string }> };
  breadcrumbs?: Array<{ message?: string; data?: unknown }>;
  tags?: unknown;
  extra?: unknown;
  contexts?: unknown;
};

/**
 * Sentry `beforeSend`/`beforeSendTransaction`: remove user identity, IP, cookies, headers,
 * request bodies and query strings, and replace wallet addresses and secrets everywhere else.
 */
export function scrubSentryEvent<T extends ScrubbableEvent>(event: T): T {
  const wallets = (input: string) => scrubTelemetryText(input);
  // Sentry's event types are interfaces; work on a loosely typed copy and cast back at the end.
  const next = { ...event } as ScrubbableEvent;

  delete next.user;
  delete next.server_name;

  if (typeof next.message === "string") next.message = wallets(next.message);
  if (typeof next.transaction === "string")
    next.transaction = scrubUrl(next.transaction);

  if (next.request) {
    const { url, ...rest } = next.request;
    delete rest.cookies;
    delete rest.headers;
    delete rest.data;
    delete rest.query_string;
    next.request = {
      ...rest,
      ...(typeof url === "string" ? { url: scrubUrl(url) } : {}),
    };
  }

  if (next.exception?.values) {
    next.exception = {
      ...next.exception,
      values: next.exception.values.map((entry) =>
        typeof entry.value === "string"
          ? { ...entry, value: wallets(entry.value) }
          : entry,
      ),
    };
  }

  if (next.breadcrumbs) {
    next.breadcrumbs = next.breadcrumbs.map((crumb) => ({
      ...crumb,
      ...(typeof crumb.message === "string"
        ? { message: wallets(crumb.message) }
        : {}),
      ...(crumb.data !== undefined
        ? { data: scrubDeep(crumb.data, scrubUrlIfLooksLikeUrl) }
        : {}),
    }));
  }

  if (next.tags !== undefined) next.tags = scrubDeep(next.tags, wallets);
  if (next.extra !== undefined) next.extra = scrubDeep(next.extra, wallets);
  if (next.contexts !== undefined)
    next.contexts = scrubDeep(next.contexts, wallets);
  return next as T;
}

function scrubUrlIfLooksLikeUrl(input: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(input) || input.startsWith("/")
    ? scrubUrl(input)
    : scrubTelemetryText(input);
}
