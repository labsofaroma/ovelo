import { beforeAll, describe, expect, it } from "vitest";
import { createKeyring } from "./auth/trade";
import { makeSigner } from "./test/creator-fixtures";
import { openSession, sealSession } from "./wallet-session";

let WALLET = "";
beforeAll(async () => {
  WALLET = (await makeSigner()).wallet;
});
const keyring = createKeyring("a".repeat(40));
const NOW = Date.parse("2026-11-15T12:00:00Z");
const bearer = (token: string) => `Bearer ${token}`;

describe("M11 wallet sessions (ws1)", () => {
  it("round-trips for its scope and expires after 15 minutes", () => {
    const { token, expiresAt } = sealSession("notify", WALLET, {
      now: NOW,
      keyring,
    });
    expect(expiresAt).toBe("2026-11-15T12:15:00.000Z");
    expect(
      openSession("notify", bearer(token), { now: NOW + 60_000, keyring }),
    ).toBe(WALLET);
    expect(() =>
      openSession("notify", bearer(token), { now: NOW + 15 * 60_000, keyring }),
    ).toThrow(expect.objectContaining({ detail: "session:expired" }));
  });

  it("a token for one scope never opens another", () => {
    const { token } = sealSession("notify", WALLET, { now: NOW, keyring });
    expect(() =>
      openSession("creator", bearer(token), { now: NOW, keyring }),
    ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
  });

  it("a changed body or a foreign key is refused; the previous key still opens during rotation", () => {
    const { token } = sealSession("notify", WALLET, { now: NOW, keyring });
    const parts = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ wallet: "11111111111111111111111111111111", exp: 9e9 }),
    ).toString("base64url");
    expect(() =>
      openSession(
        "notify",
        bearer([parts[0], parts[1], parts[2], forged, parts[4]].join(".")),
        {
          now: NOW,
          keyring,
        },
      ),
    ).toThrow(expect.objectContaining({ detail: "session:mac" }));
    expect(() =>
      openSession("notify", bearer(token), {
        now: NOW,
        keyring: createKeyring("b".repeat(40)),
      }),
    ).toThrow(expect.objectContaining({ detail: "session:kid" }));
    const rotated = createKeyring("b".repeat(40), "a".repeat(40));
    expect(
      openSession("notify", bearer(token), { now: NOW, keyring: rotated }),
    ).toBe(WALLET);
  });

  it.each([null, "", "Bearer at1.x", "Basic abc"])(
    "a missing or wrong header (%s) is refused",
    (h) => {
      expect(() => openSession("notify", h, { now: NOW, keyring })).toThrow(
        expect.objectContaining({ code: "UNAUTHORIZED" }),
      );
    },
  );
});
