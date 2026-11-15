import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/server/env";
import { stubBaseEnv } from "@/server/test/base-env";
import { makeSigner, memoryStore } from "@/server/test/creator-fixtures";
import { sealSession } from "@/server/wallet-session";
import { setSessionDepsForTests } from "./session";

/** M11 read-only wallet sessions at route level, and the CSV route's gate. */
vi.mock("@/features/portfolio/export", () => ({
  assertExportAllowed: vi.fn(async () => {}),
  exportCsv: vi.fn(
    async (wallet: string) => `section,wallet\r\npnl,${wallet}\r\n`,
  ),
}));
const challenge = await import("@/app/api/v1/session/challenge/route");
const session = await import("@/app/api/v1/session/route");
const exportRoute = await import("@/app/api/v1/portfolio/export/route");

const SITE = "https://ovelo.example";
const post = (path: string, body: unknown) =>
  new Request(`${SITE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  stubBaseEnv();
  vi.stubEnv("OVELO_SITE_URL", SITE);
  resetEnvCacheForTests();
  const store = memoryStore();
  setSessionDepsForTests({ challenges: () => store, now: () => new Date() });
});

async function open(scope: "portfolio" | "creator") {
  const signer = await makeSigner();
  const c = await (
    await challenge.POST(
      post("/api/v1/session/challenge", { scope, wallet: signer.wallet }),
    )
  ).json();
  const body = {
    scope,
    wallet: signer.wallet,
    nonce: c.nonce,
    signature: await signer.sign(c.message),
  };
  return { signer, c, body };
}

describe("wallet sessions", () => {
  it("the message is read-only and names the scope's purpose", async () => {
    const { c } = await open("portfolio");
    expect(c.message).toContain("download your Ovelo portfolio history");
    expect(c.message).toContain("Read-only");
  });

  it("a signature opens one session; its replay and a signature for another scope are refused", async () => {
    const { body } = await open("portfolio");
    const first = await session.POST(post("/api/v1/session", body));
    expect(first.status).toBe(200);
    expect((await first.json()).token).toMatch(/^ws1\.portfolio\./);
    expect((await session.POST(post("/api/v1/session", body))).status).toBe(
      401,
    );
    const other = await open("portfolio");
    expect(
      (
        await session.POST(
          post("/api/v1/session", { ...other.body, scope: "creator" }),
        )
      ).status,
    ).toBe(401);
  });
});

describe("GET /api/v1/portfolio/export", () => {
  const get = (authorization?: string) =>
    exportRoute.GET(
      new Request(
        `${SITE}/api/v1/portfolio/export`,
        authorization ? { headers: { authorization } } : {},
      ),
    );

  it("refuses without a session or with another scope's token", async () => {
    expect((await get()).status).toBe(401);
    const signer = await makeSigner();
    const creator = sealSession("creator", signer.wallet);
    expect((await get(`Bearer ${creator.token}`)).status).toBe(401);
  });

  it("serves the session wallet's CSV only (there is no wallet parameter)", async () => {
    const signer = await makeSigner();
    const { token } = sealSession("portfolio", signer.wallet);
    const res = await get(`Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(await res.text()).toContain(`pnl,${signer.wallet}`);
  });
});
