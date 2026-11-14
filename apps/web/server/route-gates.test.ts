import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { betaEntry } from "@/features/beta/paths";
import { browseBlocked } from "@/features/compliance/edge";
import { gatedSurface } from "@/features/compliance/jurisdiction";
import { isGonePath } from "./gone";
import { bucketFor } from "./request-guard";

/**
 * M9 Step 4: every page and API route, with the gates it must have, after the move from /v1 to
 * the root. Routes are discovered from app/; a route without an entry here, or an entry without
 * a route, fails the test, so a new route cannot ship without deciding its gates.
 *
 * API columns: the rate-limit bucket of each method; the geo gate (middleware + route re-check)
 * and the beta gate on the trading POSTs; the handler-level gates a trading entry point must call
 * (location → beta → terms, caps). Creator basket buys go through the quote route and the Action
 * POST, so they are covered by those rows. Page column: whether browse=block can hide it.
 */
const WEB = fileURLToPath(new URL("..", import.meta.url));

type Api = {
  sample: string;
  methods: Partial<
    Record<
      "GET" | "POST" | "DELETE",
      "read" | "write" | "trade" | "creator" | "faucet"
    >
  >;
  geo?: "trade" | "devnet";
  beta?: "quote" | "submit" | "action";
  handler?: string[];
};

const APIS: Record<string, Api> = {
  "/api/v1/trade/quote": {
    sample: "/api/v1/trade/quote",
    methods: { POST: "trade" },
    geo: "trade",
    beta: "quote",
    handler: ["assertTradingOpen", "assertTradeAccess", "checkQuoteCaps"],
  },
  "/api/v1/trade/submit": {
    sample: "/api/v1/trade/submit",
    methods: { POST: "trade" },
    geo: "trade",
    beta: "submit",
    handler: [
      "assertTradingOpen",
      "assertJurisdiction",
      "assertBetaAccess",
      "reserveForSubmit",
    ],
  },
  "/api/v1/trade/[id]": {
    sample: "/api/v1/trade/abc",
    methods: { GET: "read" },
  },
  "/api/v1/actions/baskets/[id]": {
    sample: "/api/v1/actions/baskets/sol-core",
    methods: { GET: "read", POST: "trade" },
    geo: "trade",
    beta: "action",
    handler: [
      "assertTradingOpen",
      "assertTradeAccess",
      "reserveActionQuote",
      "requestJurisdiction",
    ],
  },
  // The receipt callback for a transaction already sent: never gated (a receipt is never lost).
  "/api/v1/actions/baskets/[id]/confirm": {
    sample: "/api/v1/actions/baskets/sol-core/confirm",
    methods: { POST: "trade" },
  },
  "/api/v1/beta/challenge": {
    sample: "/api/v1/beta/challenge",
    methods: { POST: "write" },
  },
  "/api/v1/beta/redeem": {
    sample: "/api/v1/beta/redeem",
    methods: { POST: "write" },
    handler: ["assertJurisdiction"],
  },
  "/api/v1/beta/status": {
    sample: "/api/v1/beta/status",
    methods: { GET: "read" },
  },
  "/api/v1/compliance/status": {
    sample: "/api/v1/compliance/status",
    methods: { GET: "read" },
    handler: ["requestJurisdiction"],
  },
  "/api/v1/compliance/terms/challenge": {
    sample: "/api/v1/compliance/terms/challenge",
    methods: { POST: "write" },
  },
  "/api/v1/compliance/terms/accept": {
    sample: "/api/v1/compliance/terms/accept",
    methods: { POST: "write" },
    handler: ["requestJurisdiction"],
  },
  "/api/v1/creators/challenge": {
    sample: "/api/v1/creators/challenge",
    methods: { POST: "creator" },
  },
  "/api/v1/creators/invites/redeem": {
    sample: "/api/v1/creators/invites/redeem",
    methods: { POST: "creator" },
  },
  "/api/v1/creators/baskets": {
    sample: "/api/v1/creators/baskets",
    methods: { POST: "write" },
  },
  "/api/v1/creators/baskets/[id]": {
    sample: "/api/v1/creators/baskets/1f0e6a7c-3c2b-4f53-9d55-0d7c8f0c2a11",
    methods: { GET: "read", DELETE: "write" },
  },
  "/api/v1/creators/[wallet]/stats": {
    sample:
      "/api/v1/creators/7e5pxK83ceXb2iWXBizF1U8MdL7C5VcVBBXpDWaYo3x1/stats",
    methods: { GET: "read" },
  },
  "/api/v1/faucet": {
    sample: "/api/v1/faucet",
    methods: { POST: "faucet" },
    geo: "devnet",
  },
  "/api/v1/plans": { sample: "/api/v1/plans", methods: { GET: "read" } },
  "/api/v1/plans/prepare-create": {
    sample: "/api/v1/plans/prepare-create",
    methods: { POST: "trade" },
    geo: "devnet",
  },
  // Closing a plan is never gated: a user can always exit.
  "/api/v1/plans/[pda]/prepare-close": {
    sample:
      "/api/v1/plans/7e5pxK83ceXb2iWXBizF1U8MdL7C5VcVBBXpDWaYo3x1/prepare-close",
    methods: { POST: "trade" },
  },
  "/api/v1/plans/submit": {
    sample: "/api/v1/plans/submit",
    methods: { POST: "trade" },
  },
  "/api/v1/portfolio/[wallet]": {
    sample: "/api/v1/portfolio/7e5pxK83ceXb2iWXBizF1U8MdL7C5VcVBBXpDWaYo3x1",
    methods: { GET: "read" },
  },
  "/api/v1/prices": { sample: "/api/v1/prices", methods: { GET: "read" } },
  "/api/v1/health": { sample: "/api/v1/health", methods: { GET: "read" } },
  "/api/v1/revalidate": {
    sample: "/api/v1/revalidate",
    methods: { POST: "write" },
  },
};

/** Page URL → can browse=block hide it? Legal pages, the notice and files never. */
const PAGES: Record<string, { sample: string; browseBlockable: boolean }> = {
  "/": { sample: "/", browseBlockable: true },
  "/markets": { sample: "/markets", browseBlockable: true },
  "/stock/[symbol]": { sample: "/stock/TSLAx", browseBlockable: true },
  "/baskets": { sample: "/baskets", browseBlockable: true },
  "/basket/[id]": { sample: "/basket/sol-core", browseBlockable: true },
  "/basket/new": { sample: "/basket/new", browseBlockable: true },
  "/watchlist": { sample: "/watchlist", browseBlockable: true },
  "/portfolio": { sample: "/portfolio", browseBlockable: true },
  "/creators": { sample: "/creators", browseBlockable: true },
  "/invest": { sample: "/invest", browseBlockable: true },
  "/ui-preview": { sample: "/ui-preview", browseBlockable: true },
  "/privacy": { sample: "/privacy", browseBlockable: false },
  "/terms": { sample: "/terms", browseBlockable: false },
  "/restricted": { sample: "/restricted", browseBlockable: false },
  "/og.png": { sample: "/og.png", browseBlockable: false },
  "/actions.json": { sample: "/actions.json", browseBlockable: false },
  "/robots.txt": { sample: "/robots.txt", browseBlockable: false },
  "/sitemap.xml": { sample: "/sitemap.xml", browseBlockable: false },
};

/** URL paths of every page and route file under app/ (route groups removed). */
function discovered(): { apis: string[]; pages: string[] } {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "app"],
    {
      cwd: WEB,
      encoding: "utf8",
    },
  )
    .split("\n")
    .filter((f) => /\/(page|route)\.tsx?$|^app\/(robots|sitemap)\.ts$/.test(f));
  const urls = files.map((f) => {
    const special = f.match(/^app\/(robots|sitemap)\.ts$/);
    if (special)
      return special[1] === "robots" ? "/robots.txt" : "/sitemap.xml";
    const path = f
      .replace(/^app/, "")
      .replace(/\/\([^)]+\)/g, "")
      .replace(/\/(page|route)\.tsx?$/, "");
    return path === "" ? "/" : path;
  });
  return {
    apis: urls.filter((u) => u.startsWith("/api/")).sort(),
    pages: urls.filter((u) => !u.startsWith("/api/")).sort(),
  };
}

const routeFile = (url: string) =>
  execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      `app${url}/route.ts`,
    ],
    {
      cwd: WEB,
      encoding: "utf8",
    },
  ).trim();

describe("every route has a gate entry (and every entry a route)", () => {
  it("APIs", () => {
    expect(discovered().apis).toEqual(Object.keys(APIS).sort());
  });
  it("pages and files", () => {
    expect(discovered().pages).toEqual(Object.keys(PAGES).sort());
  });
});

describe.each(Object.entries(APIS))("%s", (route, api) => {
  it("rate-limit bucket per method", () => {
    for (const [method, bucket] of Object.entries(api.methods))
      expect(bucketFor(api.sample, method), `${method} ${api.sample}`).toBe(
        bucket,
      );
  });

  it("geo gate and beta gate on POST, exactly where expected", () => {
    expect(gatedSurface(api.sample, "POST")).toBe(api.geo ?? null);
    expect(betaEntry(api.sample, "POST")).toBe(api.beta ?? null);
    expect(isGonePath(api.sample)).toBe(false);
  });

  it("handler-level gates (re-checked inside the route)", () => {
    const source = readFileSync(`${WEB}/${routeFile(route)}`, "utf8");
    for (const gate of api.handler ?? [])
      expect(source, gate).toContain(`${gate}(`);
  });
});

describe("browse=block (restricted visitor)", () => {
  const env = { AROMA_COMPLIANCE_BROWSE: "block", AROMA_TRUST_PROXY: "true" };
  const us = new Headers({ "x-vercel-ip-country": "US" });
  it.each(Object.entries(PAGES))("%s", (_route, page) => {
    expect(browseBlocked(page.sample, us, env)).toBe(page.browseBlockable);
  });
});
