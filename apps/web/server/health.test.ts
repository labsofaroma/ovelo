import { describe, expect, it } from "vitest";
import {
  classifyRpcLag,
  httpStatusFor,
  type Probe,
  RPC_LAG_DEGRADED_SECONDS,
  RPC_LAG_FAIL_SECONDS,
  runHealthChecks,
} from "./health";

const ok: Probe = async () => ({ status: "ok" });

describe("runHealthChecks", () => {
  it("is ok (HTTP 200) when every check passes", async () => {
    const report = await runHealthChecks({
      rpc: async () => ({ status: "ok", slot: 5 }),
      redis: ok,
      db: ok,
    });
    expect(report.status).toBe("ok");
    expect(httpStatusFor(report)).toBe(200);
    expect(report.checks.rpc).toMatchObject({ status: "ok", slot: 5 });
    expect(report.checks.redis?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("is down (HTTP 503) when any check fails, with per-check status", async () => {
    const report = await runHealthChecks({
      rpc: ok,
      redis: async () => ({ status: "fail" }),
      db: ok,
    });
    expect(report.status).toBe("down");
    expect(httpStatusFor(report)).toBe(503);
    expect(report.checks.redis?.status).toBe("fail");
    expect(report.checks.rpc?.status).toBe("ok");
  });

  it("stays 200 when degraded or skipped", async () => {
    const report = await runHealthChecks({
      rpc: async () => ({ status: "degraded", lagSeconds: 30 }),
      redis: async () => ({ status: "skipped" }),
      db: ok,
    });
    expect(report.status).toBe("degraded");
    expect(httpStatusFor(report)).toBe(200);
  });

  it("does not leak internal error text when a probe throws", async () => {
    const report = await runHealthChecks({
      db: async () => {
        throw new Error(
          "connect ECONNREFUSED 10.1.2.3:5432 postgres://admin:hunter2@db.internal/aroma",
        );
      },
    });
    const body = JSON.stringify(report);
    expect(report.checks.db?.status).toBe("fail");
    expect(body).not.toMatch(
      /ECONNREFUSED|hunter2|10\.1\.2\.3|db\.internal|postgres/,
    );
  });

  it("times a hanging probe out instead of hanging the endpoint", async () => {
    const hang: Probe = () => new Promise(() => undefined);
    const started = Date.now();
    const report = await runHealthChecks(
      { rpc: hang, redis: ok },
      { timeoutMs: 40 },
    );
    expect(Date.now() - started).toBeLessThan(1000);
    expect(report.checks.rpc?.status).toBe("fail");
    expect(report.checks.redis?.status).toBe("ok");
    expect(httpStatusFor(report)).toBe(503);
  });

  it("runs checks in parallel", async () => {
    const slow: Probe = () =>
      new Promise((resolve) => setTimeout(() => resolve({ status: "ok" }), 60));
    const started = Date.now();
    await runHealthChecks({ a: slow, b: slow, c: slow });
    expect(Date.now() - started).toBeLessThan(150);
  });
});

describe("classifyRpcLag", () => {
  it("is ok, degraded, then fail as the node falls behind the chain", () => {
    expect(classifyRpcLag(2)).toBe("ok");
    expect(classifyRpcLag(RPC_LAG_DEGRADED_SECONDS)).toBe("ok");
    expect(classifyRpcLag(RPC_LAG_DEGRADED_SECONDS + 1)).toBe("degraded");
    expect(classifyRpcLag(RPC_LAG_FAIL_SECONDS + 1)).toBe("fail");
  });
});
