import { describe, expect, it } from "vitest";
import { publicLaunchFindings } from "./prod-env.public";

/** M9 Phase B: `pnpm check:prod-env --profile production` (the public spot launch). */
const status = (env: Record<string, string>, name: string) =>
  publicLaunchFindings(env).find((f) => f.name === name)?.status;

describe("production profile (public launch)", () => {
  it("the beta gate may be off; on or unset warns until runbook step 9", () => {
    expect(status({ AROMA_BETA_GATE: "off" }, "AROMA_BETA_GATE")).toBe("ok");
    expect(status({ AROMA_BETA_GATE: "on" }, "AROMA_BETA_GATE")).toBe(
      "warning",
    );
    expect(status({}, "AROMA_BETA_GATE")).toBe("warning");
  });

  it("the site URL is the production domain: a beta host fails, a vercel.app host warns", () => {
    expect(
      status({ AROMA_SITE_URL: "https://aroma.trade" }, "AROMA_SITE_URL"),
    ).toBeUndefined();
    expect(
      status({ AROMA_SITE_URL: "https://beta.aroma.trade" }, "AROMA_SITE_URL"),
    ).toBe("forbidden");
    expect(
      status(
        { AROMA_SITE_URL: "https://aroma-web.vercel.app" },
        "AROMA_SITE_URL",
      ),
    ).toBe("warning");
  });

  it("refuses a browser-visible variable v1 does not read, never printing its value", () => {
    const findings = publicLaunchFindings({
      NEXT_PUBLIC_LEGACY_LOGIN_APP_ID: "secret-ish",
    });
    expect(findings).toContainEqual(
      expect.objectContaining({
        name: "NEXT_PUBLIC_LEGACY_LOGIN_APP_ID",
        status: "forbidden",
      }),
    );
    expect(JSON.stringify(findings)).not.toContain("secret-ish");
  });

  it("allows the browser variables v1 reads", () => {
    expect(
      publicLaunchFindings({
        NEXT_PUBLIC_SOLANA_RPC_URL: "https://rpc.aroma.trade",
        NEXT_PUBLIC_SENTRY_ENVIRONMENT: "production",
      }).filter((f) => f.status === "forbidden"),
    ).toEqual([]);
  });
});
