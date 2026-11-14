import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * middleware.ts for the creator API (M5b Part A). Handlers no longer check Origin or rate limit
 * themselves (they used to, with a request.url fallback and one shared "local" bucket); M4's
 * middleware owns both for every /api/* route.
 */
const { middleware } = await import("@/middleware");

beforeEach(() => vi.stubEnv("NODE_ENV", "development"));
afterEach(() => vi.unstubAllEnvs());

const post = (
  url: string,
  headers: Record<string, string>,
  body = "{}",
  method = "POST",
) =>
  new NextRequest(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body,
  });

const CREATOR_MUTATIONS = [
  ["POST", "/api/v1/creators/challenge"],
  ["POST", "/api/v1/creators/invites/redeem"],
  ["POST", "/api/v1/creators/baskets"],
  ["DELETE", "/api/v1/creators/baskets/1f0e6a7c-3c2b-4f53-9d55-0d7c8f0c2a11"],
] as const;

describe("creator routes: origin (A2)", () => {
  it.each(CREATOR_MUTATIONS)(
    "%s %s from another site is refused before the handler",
    async (method, path) => {
      const response = await middleware(
        post(
          `http://localhost:3000${path}`,
          { origin: "https://evil.example" },
          "{}",
          method,
        ),
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        code: "ORIGIN_FORBIDDEN",
        message: expect.any(String),
      });
    },
  );

  it("a same-site publish under next start is accepted (bind address localhost, public Host via proxy)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AROMA_TRUST_PROXY", "true");
    vi.stubEnv("AROMA_SITE_URL", "https://aroma.example");
    const response = await middleware(
      post("http://localhost:3000/api/v1/creators/baskets", {
        host: "localhost:3000",
        "x-forwarded-host": "aroma.example",
        "x-forwarded-proto": "https",
        origin: "https://aroma.example",
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://aroma.example",
    );
  });

  it("a same-site publish to a local next start on 127.0.0.1 is accepted", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await middleware(
      post("http://localhost:3200/api/v1/creators/challenge", {
        host: "127.0.0.1:3200",
        origin: "http://127.0.0.1:3200",
      }),
    );
    expect(response.status).toBe(200);
  });

  it("a request without Origin (a native client) reaches the handler, which still needs a signature", async () => {
    const response = await middleware(
      post("http://localhost:3000/api/v1/creators/invites/redeem", {}),
    );
    expect(response.status).toBe(200);
  });
});
