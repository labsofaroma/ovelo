import { describe, expect, it } from "vitest";
import { applyPublicEnv, publicEnvOf } from "../../../deploy/public-env.mjs";
import { connectSources } from "./csp";

/** Phase H fix: the image's NEXT_PUBLIC_* build values reach the runtime (deploy/public-env.mjs). */
describe("deploy/public-env.mjs", () => {
  it("keeps only NEXT_PUBLIC_* keys, sorted", () => {
    expect(
      publicEnvOf({
        NEXT_PUBLIC_SOLANA_RPC_URL: "https://rpc.example.test",
        OVELO_TRADE_SECRET: "never",
        DATABASE_URL: "never",
        NEXT_PUBLIC_SENTRY_DSN: "https://k@o1.ingest.sentry.io/2",
        next_public_lower: "no",
      }),
    ).toEqual({
      NEXT_PUBLIC_SENTRY_DSN: "https://k@o1.ingest.sentry.io/2",
      NEXT_PUBLIC_SOLANA_RPC_URL: "https://rpc.example.test",
    });
  });

  it("applies the baked values over the env file and names (never prints) the differences", () => {
    const env: Record<string, string | undefined> = {
      NEXT_PUBLIC_SOLANA_RPC_URL: "https://other.example.test",
      NEXT_PUBLIC_SENTRY_DSN: "https://k@o1.ingest.sentry.io/2",
    };
    const overridden = applyPublicEnv(env, {
      NEXT_PUBLIC_SOLANA_RPC_URL: "https://rpc.example.test",
      NEXT_PUBLIC_SENTRY_DSN: "https://k@o1.ingest.sentry.io/2",
      OVELO_TRADE_SECRET: "ignored: not public",
    });
    expect(overridden).toEqual(["NEXT_PUBLIC_SOLANA_RPC_URL"]);
    expect(env.NEXT_PUBLIC_SOLANA_RPC_URL).toBe("https://rpc.example.test");
    expect(env.OVELO_TRADE_SECRET).toBeUndefined();
  });

  it("so the CSP connect-src allows the bundle's RPC and Sentry origins", () => {
    const env: Record<string, string | undefined> = {};
    applyPublicEnv(env, {
      NEXT_PUBLIC_SOLANA_RPC_URL: "https://rpc.example.test/?k=1",
      NEXT_PUBLIC_SENTRY_DSN: "https://k@o1.ingest.sentry.io/2",
    });
    const sources = connectSources(env as Parameters<typeof connectSources>[0]);
    expect(sources).toContain("https://rpc.example.test");
    expect(sources).toContain("wss://rpc.example.test");
    expect(sources).toContain("https://o1.ingest.sentry.io");
  });
});
