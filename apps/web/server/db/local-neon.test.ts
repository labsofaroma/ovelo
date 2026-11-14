import { neonConfig } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";
import { configureLocalNeon, localNeonProxy } from "./local-neon";

/** M5b B6: the local WebSocket proxy can only ever apply to a loopback database. */
const LOCAL = "postgres://aroma:pw@127.0.0.1:54329/aroma";
const PROXY = { AROMA_LOCAL_NEON_WS_PROXY: "127.0.0.1:54330" };

describe("localNeonProxy", () => {
  it("applies to a loopback DATABASE_URL with the switch set", () => {
    expect(localNeonProxy(LOCAL, PROXY)).toBe("127.0.0.1:54330");
    expect(localNeonProxy("postgres://a:b@localhost:5432/x", PROXY)).toBe(
      "127.0.0.1:54330",
    );
  });

  it("never applies to a remote database, without the switch, in Vercel production, or to a remote proxy", () => {
    expect(
      localNeonProxy(
        "postgres://u:p@ep-x.eu-central-1.aws.neon.tech/db",
        PROXY,
      ),
    ).toBeNull();
    expect(localNeonProxy(LOCAL, {})).toBeNull();
    expect(
      localNeonProxy(LOCAL, { ...PROXY, VERCEL_ENV: "production" }),
    ).toBeNull();
    expect(
      localNeonProxy(LOCAL, { AROMA_LOCAL_NEON_WS_PROXY: "evil.example:80" }),
    ).toBeNull();
    expect(localNeonProxy("not a url", PROXY)).toBeNull();
  });
});

describe("configureLocalNeon", () => {
  it("leaves the driver untouched unless the gate holds", () => {
    const before = neonConfig.useSecureWebSocket;
    expect(configureLocalNeon("postgres://u:p@db.neon.tech/x", PROXY)).toBe(
      false,
    );
    expect(neonConfig.useSecureWebSocket).toBe(before);
  });

  it("points the driver at the local proxy over plain ws", () => {
    expect(configureLocalNeon(LOCAL, PROXY)).toBe(true);
    expect(neonConfig.useSecureWebSocket).toBe(false);
    expect(neonConfig.pipelineConnect).toBe(false);
    const wsProxy = neonConfig.wsProxy as (
      host: string,
      port: number | string,
    ) => string;
    expect(wsProxy("127.0.0.1", 54329)).toBe("127.0.0.1:54330/v1");
  });
});
