import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * QStash request signatures (`Upstash-Signature`): a JWT (HS256) signed with the current or the
 * next signing key, whose claims are `iss: "Upstash"`, `sub` = the destination URL, `exp`/`nbf`,
 * and `body` = base64url(SHA-256(raw body)). Both keys are tried, so a key rotation never drops
 * a run. Verified before any work; a failure is 401 and nothing runs.
 */

export class SignatureError extends Error {
  constructor(readonly reason: string) {
    super(`QStash signature rejected: ${reason}`);
    this.name = "SignatureError";
  }
}

const b64url = (bytes: Buffer) => bytes.toString("base64url");
const CLOCK_SKEW_S = 60;

type Claims = {
  iss?: unknown;
  sub?: unknown;
  exp?: unknown;
  nbf?: unknown;
  iat?: unknown;
  body?: unknown;
  jti?: unknown;
};

function verifyWith(
  key: string,
  token: string,
  body: string,
  options: { url?: string; now: number },
): void {
  const parts = token.split(".");
  if (parts.length !== 3) throw new SignatureError("malformed token");
  const [header, payload, signature] = parts as [string, string, string];
  let head: { alg?: unknown; typ?: unknown };
  let claims: Claims;
  try {
    head = JSON.parse(
      Buffer.from(header, "base64url").toString("utf8"),
    ) as typeof head;
    claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Claims;
  } catch {
    throw new SignatureError("undecodable token");
  }
  if (head.alg !== "HS256") throw new SignatureError("unexpected algorithm");
  const expected = createHmac("sha256", key)
    .update(`${header}.${payload}`)
    .digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    throw new SignatureError("bad signature");
  if (claims.iss !== "Upstash") throw new SignatureError("wrong issuer");
  if (options.url !== undefined && claims.sub !== options.url)
    throw new SignatureError("wrong destination");
  const now = Math.floor(options.now / 1000);
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_S < now)
    throw new SignatureError("expired");
  if (typeof claims.nbf === "number" && claims.nbf - CLOCK_SKEW_S > now)
    throw new SignatureError("not yet valid");
  const digest = b64url(createHash("sha256").update(body).digest());
  // QStash pads the body hash in some SDK versions; compare without padding.
  if (
    typeof claims.body !== "string" ||
    claims.body.replace(/=+$/, "") !== digest
  )
    throw new SignatureError("body mismatch");
}

export function verifyQStashSignature(input: {
  signature: string | null;
  body: string;
  currentKey: string;
  nextKey: string;
  url?: string;
  now?: number;
}): void {
  if (!input.signature) throw new SignatureError("missing Upstash-Signature");
  const options = { url: input.url, now: input.now ?? Date.now() };
  try {
    verifyWith(input.currentKey, input.signature, input.body, options);
  } catch (first) {
    try {
      verifyWith(input.nextKey, input.signature, input.body, options);
    } catch {
      throw first;
    }
  }
}

/** Sign exactly as QStash does (local runs and tests: the "signed direct call"). */
export function signQStashRequest(input: {
  key: string;
  url: string;
  body: string;
  now?: number;
  ttlSeconds?: number;
}): string {
  const now = Math.floor((input.now ?? Date.now()) / 1000);
  const header = b64url(
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })),
  );
  const payload = b64url(
    Buffer.from(
      JSON.stringify({
        iss: "Upstash",
        sub: input.url,
        exp: now + (input.ttlSeconds ?? 300),
        nbf: now,
        iat: now,
        jti: `jwt_${createHash("sha256").update(`${now}:${Math.random()}`).digest("hex").slice(0, 16)}`,
        body: b64url(createHash("sha256").update(input.body).digest()),
      }),
    ),
  );
  const signature = b64url(
    createHmac("sha256", input.key).update(`${header}.${payload}`).digest(),
  );
  return `${header}.${payload}.${signature}`;
}
