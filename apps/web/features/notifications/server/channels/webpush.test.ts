import {
  createDecipheriv,
  createECDH,
  createPublicKey,
  hkdfSync,
  verify,
} from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  allowedPushEndpoint,
  encryptPayload,
  generateVapidKeys,
  vapidAuthorization,
} from "./webpush";

const b64u = (v: string) => Buffer.from(v, "base64url");

describe("RFC 8291 aes128gcm encryption", () => {
  it("matches the RFC 8291 Appendix A test vector byte for byte", () => {
    const body = encryptPayload({
      plaintext: Buffer.from("When I grow up, I want to be a watermelon"),
      p256dh:
        "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
      auth: "BTBZMqHH6r4Tts7J_aSIgg",
      fixed: {
        asPrivate: b64u("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
        salt: b64u("DGv6ra1nlYgDCS1FRnbzlw"),
      },
    });
    expect(body.toString("base64url")).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
  });

  it("round-trips with a fresh key: the user agent can decrypt what we send", () => {
    const ua = createECDH("prime256v1");
    ua.generateKeys();
    const auth = Buffer.alloc(16, 7);
    const body = encryptPayload({
      plaintext: Buffer.from('{"title":"t"}'),
      p256dh: ua.getPublicKey().toString("base64url"),
      auth: auth.toString("base64url"),
    });
    const salt = body.subarray(0, 16);
    const idlen = body.readUInt8(20);
    const asPublic = body.subarray(21, 21 + idlen);
    const shared = ua.computeSecret(asPublic);
    const info = Buffer.concat([
      Buffer.from("WebPush: info\0"),
      ua.getPublicKey(),
      asPublic,
    ]);
    const ikm = Buffer.from(hkdfSync("sha256", shared, auth, info, 32));
    const cek = Buffer.from(
      hkdfSync("sha256", ikm, salt, "Content-Encoding: aes128gcm\0", 16),
    );
    const nonce = Buffer.from(
      hkdfSync("sha256", ikm, salt, "Content-Encoding: nonce\0", 12),
    );
    const record = body.subarray(21 + idlen);
    const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
    decipher.setAuthTag(record.subarray(record.length - 16));
    const plain = Buffer.concat([
      decipher.update(record.subarray(0, record.length - 16)),
      decipher.final(),
    ]);
    expect(plain.toString()).toBe('{"title":"t"}\u0002');
  });
});

describe("VAPID", () => {
  it("signs an ES256 JWT for the push service origin that verifies with the public key", () => {
    const keys = generateVapidKeys();
    const header = vapidAuthorization({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      ...keys,
      subject: "mailto:ops@aroma.example",
      now: 1_800_000_000_000,
    });
    const match = header.match(/^vapid t=([^,]+), k=(.+)$/);
    expect(match?.[2]).toBe(keys.publicKey);
    const [h, c, s] = match![1]!.split(".") as [string, string, string];
    const claims = JSON.parse(b64u(c).toString());
    expect(claims).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: 1_800_000_000 + 43_200,
      sub: "mailto:ops@aroma.example",
    });
    const pub = b64u(keys.publicKey);
    const key = createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: pub.subarray(1, 33).toString("base64url"),
        y: pub.subarray(33).toString("base64url"),
      },
      format: "jwk",
    });
    expect(
      verify(
        "sha256",
        Buffer.from(`${h}.${c}`),
        { key, dsaEncoding: "ieee-p1363" },
        b64u(s),
      ),
    ).toBe(true);
  });
});

describe("push endpoint allowlist (no request to an arbitrary URL)", () => {
  it.each([
    ["https://fcm.googleapis.com/fcm/send/x", true],
    ["https://updates.push.services.mozilla.com/wpush/v2/x", true],
    ["https://web.push.apple.com/x", true],
    ["https://wns2-par02p.notify.windows.com/w/?token=x", true],
    ["http://fcm.googleapis.com/x", false],
    ["https://fcm.googleapis.com:8443/x", false],
    ["https://evil.example/fcm.googleapis.com", false],
    ["https://fcm.googleapis.com.evil.example/x", false],
    ["https://127.0.0.1/x", false],
    ["https://user:pw@fcm.googleapis.com/x", false],
    ["not a url", false],
  ])("%s → %s", (endpoint, allowed) => {
    expect(allowedPushEndpoint(endpoint)).toBe(allowed);
  });
});
