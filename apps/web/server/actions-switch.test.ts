import { describe, expect, it } from "vitest";
import { actionsOff, assertActionsOpen } from "./actions-switch";

const SELF = (deploy: string) => ({
  OVELO_PLATFORM: "selfhost",
  OVELO_DEPLOY_ENV: deploy,
  NODE_ENV: "production",
});

describe("Solana Actions switch (server/actions-switch.ts)", () => {
  it("is off by default under the production rules (production, beta, Vercel production)", () => {
    expect(actionsOff(SELF("production"))).toBe(true);
    expect(actionsOff(SELF("beta"))).toBe(true);
    expect(actionsOff({ VERCEL: "1", VERCEL_ENV: "production" })).toBe(true);
    // Fail closed: a production boot without a platform answer.
    expect(actionsOff({ NODE_ENV: "production" })).toBe(true);
  });

  it("opens in production only when OVELO_ACTIONS=on is explicit", () => {
    expect(actionsOff({ ...SELF("production"), OVELO_ACTIONS: "on" })).toBe(
      false,
    );
  });

  it("is on in development and previews unless turned off", () => {
    expect(actionsOff({})).toBe(false);
    expect(actionsOff({ VERCEL: "1", VERCEL_ENV: "preview" })).toBe(false);
    expect(actionsOff({ OVELO_ACTIONS: "off" })).toBe(true);
  });

  it("refuses with TRADING_UNAVAILABLE", () => {
    expect(() => assertActionsOpen(SELF("production"))).toThrow(
      expect.objectContaining({ code: "TRADING_UNAVAILABLE" }),
    );
  });
});
