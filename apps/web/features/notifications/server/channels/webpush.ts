import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign,
} from "node:crypto";

/**
 * Web Push with `node:crypto` only (no `web-push` dependency, M11 decision 2):
 * - RFC 8291 message encryption, content coding `aes128gcm` (RFC 8188), one record;
 * - RFC 8292 VAPID: an ES256 JWT for the push service's origin, `Authorization: vapid t=…, k=…`.
 * Pure functions; tested against the RFC 8291 Appendix A vector.
 */

const b64u = (value: string) => Buffer.from(value, "base64url");
const hkdf = (salt: Buffer, ikm: Buffer, info: Buffer, length: number) =>
  Buffer.from(hkdfSync("sha256", ikm, salt, info, length));

export type EncryptInput = {
  plaintext: Buffer;
  /** The browser's `keys.p256dh` (65-byte uncompressed P-256 point) and `keys.auth` (16 bytes). */
  p256dh: string;
  auth: string;
  /** Test vectors only: a fixed application-server key pair and salt. */
  fixed?: { asPrivate: Buffer; salt: Buffer };
};

/** The request body for the push service: header (salt, rs, keyid) + one encrypted record. */
export function encryptPayload(input: EncryptInput): Buffer {
  const uaPublic = b64u(input.p256dh);
  const authSecret = b64u(input.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4)
    throw new Error("p256dh must be an uncompressed P-256 point");
  if (authSecret.length !== 16) throw new Error("auth must be 16 bytes");
  const ecdh = createECDH("prime256v1");
  if (input.fixed) ecdh.setPrivateKey(input.fixed.asPrivate);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const salt = input.fixed?.salt ?? randomBytes(16);

  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0", "utf8"),
    uaPublic,
    asPublic,
  ]);
  const ikm = hkdf(authSecret, shared, keyInfo, 32);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);

  const recordSize = 4096;
  // One record: plaintext, then the 0x02 "last record" delimiter (no extra padding).
  if (input.plaintext.length + 1 + 16 > recordSize - 86)
    throw new Error("payload too large for one record");
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([
    cipher.update(Buffer.concat([input.plaintext, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(recordSize, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

/** `Authorization` header value for one push service origin (RFC 8292 §3). */
export function vapidAuthorization(input: {
  endpoint: string;
  publicKey: string;
  privateKey: string;
  subject: string;
  now?: number;
}): string {
  const pub = b64u(input.publicKey);
  if (pub.length !== 65 || pub[0] !== 4)
    throw new Error("VAPID public key must be an uncompressed P-256 point");
  const key = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: input.privateKey,
      x: pub.subarray(1, 33).toString("base64url"),
      y: pub.subarray(33, 65).toString("base64url"),
    },
    format: "jwk",
  });
  const exp = Math.floor((input.now ?? Date.now()) / 1000) + 12 * 3600;
  const part = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const signed = `${part({ typ: "JWT", alg: "ES256" })}.${part({
    aud: new URL(input.endpoint).origin,
    exp,
    sub: input.subject,
  })}`;
  const signature = sign("sha256", Buffer.from(signed), {
    key,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return `vapid t=${signed}.${signature}, k=${input.publicKey}`;
}

/**
 * Push services Ovelo will POST to. The endpoint comes from the browser, so anything else is
 * refused (no request to an arbitrary URL: SSRF).
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /^[a-z0-9-]+\.push\.apple\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
];

export function allowedPushEndpoint(endpoint: string): boolean {
  if (!URL.canParse(endpoint)) return false;
  const url = new URL(endpoint);
  return (
    url.protocol === "https:" &&
    url.port === "" &&
    !url.username &&
    !url.password &&
    PUSH_HOSTS.some((host) => host.test(url.hostname))
  );
}

/** A fresh VAPID key pair (base64url), for `notify:vapid`. Never committed. */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey().toString("base64url"),
    privateKey: ecdh.getPrivateKey().toString("base64url"),
  };
}
