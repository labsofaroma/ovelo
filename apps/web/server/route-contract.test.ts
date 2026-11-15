import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { stubBaseEnv } from "@/server/test/base-env";

/**
 * M9 Step 7 (AUDIT M-5): every /api/v1 handler, discovered from app/api/v1, answers an error with
 * exactly `{ code, message }` (two strings): no stack, detail, cause or upstream text. Each
 * exported method is called with an invalid request; the network is stubbed to fail, so handlers
 * that reach a provider, Redis or Postgres take their error path too. Nothing leaves the machine.
 */
const WEB = fileURLToPath(new URL("..", import.meta.url));
const ROUTES = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "app/api/v1"],
  { cwd: WEB, encoding: "utf8" },
)
  .split("\n")
  .filter((file) => file.endsWith("/route.ts"));

const SAMPLE_PARAMS = {
  id: "not-a-real-id",
  wallet: "not-a-wallet",
  pda: "not-a-pda",
};
const METHODS = ["GET", "POST", "DELETE"] as const;

/** Read-only status routes with no input: they always answer 200 with their report. */
const NO_ERROR_PATH = new Set([
  "app/api/v1/beta/status/route.ts",
  "app/api/v1/compliance/status/route.ts",
  // M11: which notification channels exist (public facts, no input).
  "app/api/v1/notifications/config/route.ts",
  // Phase H: the liveness probe (process only; no input, no error path).
  "app/api/v1/health/live/route.ts",
]);
/** The health report is its own documented contract (facts only), 503 when something is down. */
const HEALTH = "app/api/v1/health/route.ts";

beforeAll(() => {
  stubBaseEnv();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("OVELO_COMPLIANCE_MISSING_COUNTRY", "allow");
  vi.stubGlobal("fetch", async () => {
    throw new TypeError("network disabled in route-contract.test.ts");
  });
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("route contract: errors are { code, message } only", () => {
  it("finds every v1 route", () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(25);
  });

  it.each(ROUTES)(
    "%s",
    async (file) => {
      const routeModule = (await import(
        `@/${file.replace(/\.ts$/, "")}`
      )) as Record<string, unknown>;
      const context = { params: Promise.resolve(SAMPLE_PARAMS) };
      let checked = 0;
      for (const method of METHODS) {
        const handler = routeModule[method];
        if (typeof handler !== "function") continue;
        const request = new Request(
          `http://localhost:3000/${file.replace(/^app\//, "").replace(/\/route\.ts$/, "")}`,
          {
            method,
            headers: {
              "content-type": "application/json",
              origin: "http://localhost:3000",
            },
            ...(method === "GET" ? {} : { body: "{not json" }),
          },
        );
        const response = (await (
          handler as (r: Request, c: unknown) => Promise<Response>
        )(request, context)) as Response;
        if (response.status < 400) continue;
        checked += 1;
        const body = (await response.json()) as Record<string, unknown>;
        if (file === HEALTH) {
          expect(Object.keys(body).sort()).toEqual([
            "checks",
            "status",
            "timestamp",
          ]);
          expect(JSON.stringify(body)).not.toMatch(
            /network disabled|example\.test|Error/,
          );
          continue;
        }
        expect(Object.keys(body).sort(), `${method} ${file}`).toEqual([
          "code",
          "message",
        ]);
        expect(typeof body.code).toBe("string");
        expect(typeof body.message).toBe("string");
        expect(body.code).toMatch(/^[A-Z_]+$/);
        // No internal detail: our own stub's text and stack frames never reach the body.
        expect(String(body.message)).not.toMatch(
          /network disabled|at \S+:\d+|Error:/,
        );
      }
      // Every route but the input-less status reports can be driven to an error here.
      if (NO_ERROR_PATH.has(file)) expect(checked, file).toBe(0);
      else expect(checked, file).toBeGreaterThan(0);
    },
    30_000,
  );
});
