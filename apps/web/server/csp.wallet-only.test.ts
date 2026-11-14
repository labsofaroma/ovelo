import { describe, expect, it } from "vitest";
import { buildCsp, connectSources, FIXED_CONNECT_SOURCES } from "./csp";

/**
 * W1 (wallet-only login): the v1 CSP lists exactly the hosts the Wallet Standard stack and the
 * app need. An exact allowlist, so any embedded-wallet or other third-party host added later
 * fails here until it is reviewed.
 */
describe("v1 CSP after wallet-only login", () => {
  it("fixed connect-src is exactly the reviewed list", () => {
    expect([...FIXED_CONNECT_SOURCES]).toEqual([
      "https://api.jup.ag",
      "https://lite-api.jup.ag",
      "https://hermes.pyth.network",
      "https://mainnet.block-engine.jito.wtf",
      "wss://relay.walletconnect.com",
      "wss://relay.walletconnect.org",
      "https://verify.walletconnect.org",
      "https://explorer-api.walletconnect.com",
      "https://challenges.cloudflare.com",
    ]);
  });

  it("frame-src is WalletConnect verify and Turnstile only", () => {
    const csp = buildCsp({ nonce: "n", env: {}, development: false });
    const frame = csp.split("; ").find((d) => d.startsWith("frame-src"));
    expect(frame).toBe(
      "frame-src https://verify.walletconnect.org https://challenges.cloudflare.com",
    );
  });

  it("connect-src with defaults has no wildcard outside the reviewed list", () => {
    const sources = connectSources({});
    expect(sources.filter((s) => s.includes("*"))).toEqual([]);
  });
});
