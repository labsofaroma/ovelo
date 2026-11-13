import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultProbes } from "./health";
import { jupiterProbe, PYTH_SOL_USD, pythProbe } from "./health-providers";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllEnvs());

describe("provider health probes (AUDIT M-7)", () => {
  it("are registered on GET /api/v1/health", () => {
    expect(Object.keys(defaultProbes)).toEqual(
      expect.arrayContaining(["rpc", "redis", "db", "jupiter", "pyth"]),
    );
  });

  it("Jupiter: ok with a key, degraded keyless or rate-limited, fail otherwise; no URLs in facts", async () => {
    vi.stubEnv("JUPITER_API_KEY", "k");
    const seen: string[] = [];
    const ok = await jupiterProbe(async (url) => {
      seen.push(String(url));
      return json({ [USDC]: { usdPrice: 1 } });
    })();
    expect(ok).toEqual({ status: "ok", keyed: true });
    expect(seen[0]).toMatch(/^https:\/\/api\.jup\.ag\//);
    vi.stubEnv("JUPITER_API_KEY", "");
    expect(
      (await jupiterProbe(async () => json({ [USDC]: { usdPrice: 1 } }))())
        .status,
    ).toBe("degraded");
    expect((await jupiterProbe(async () => json({}, 429))()).status).toBe(
      "degraded",
    );
    expect((await jupiterProbe(async () => json({}, 500))()).status).toBe(
      "fail",
    );
    expect((await jupiterProbe(async () => json({}))()).status).toBe("fail");
    expect(JSON.stringify(ok)).not.toMatch(/http/);
  });

  it("Pyth without a key is skipped (optional provider), with no request", async () => {
    vi.stubEnv("PYTH_API_KEY", "");
    let called = false;
    expect(
      await pythProbe(async () => {
        called = true;
        return json({});
      })(),
    ).toEqual({ status: "skipped", keyed: false });
    expect(called).toBe(false);
  });

  it("Pyth: fresh is ok, old is degraded, malformed or HTTP errors fail", async () => {
    vi.stubEnv("PYTH_API_KEY", "test-key");
    const at = (publish_time: unknown) => async (url: RequestInfo | URL) => {
      expect(String(url)).toContain(PYTH_SOL_USD);
      return json({ parsed: [{ price: { publish_time } }] });
    };
    const now = () => 1_800_000_000_000;
    expect(await pythProbe(at(1_800_000_000 - 5), now)()).toEqual({
      status: "ok",
      ageSeconds: 5,
    });
    expect((await pythProbe(at(1_800_000_000 - 600), now)()).status).toBe(
      "degraded",
    );
    expect((await pythProbe(at("x"), now)()).status).toBe("fail");
    expect((await pythProbe(async () => json({}, 503), now)()).status).toBe(
      "fail",
    );
  });
});
