import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { makeSigner } from "../../server/test/creator-fixtures";

/**
 * Helpers for the creator E2E (M5b B7). TEST-ONLY. The second wallet is a throwaway WebCrypto
 * key in this Node process (server/test/creator-fixtures); the main creator is M4's
 * deterministic E2E wallet. Everything talks to the local app, the local fork RPC and the local
 * Postgres only.
 */
export const RPC = process.env.E2E_RPC_URL ?? "http://127.0.0.1:8899";
export const LEGS = JSON.parse(process.env.E2E_CREATOR_LEGS ?? "[]") as {
  mint: string;
  symbol: string;
}[];
export const SHOTS = "test-results/m5-screens";
mkdirSync(SHOTS, { recursive: true });

/** The admin CLI (scripts/create-invite.ts) against the local Postgres; returns the code. */
export function createInvite(): string {
  const out = execFileSync(
    "pnpm",
    ["exec", "tsx", "scripts/create-invite.ts", "--days", "1"],
    {
      encoding: "utf8",
      env: process.env,
    },
  );
  const code = /Code \(shown once, not stored\): (\S+)/.exec(out)?.[1];
  if (!code) throw new Error("create-invite printed no code");
  return code;
}

export type NodeSigner = Awaited<ReturnType<typeof makeSigner>>;
export const nodeSigner = makeSigner;

/** JSON API call with a client IP of its own (separate rate-limit buckets behind the proxy). */
export async function api(
  request: APIRequestContext,
  ip: string,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const response = await request.fetch(path, {
    method,
    headers: {
      "content-type": "application/json",
      "x-real-ip": ip,
      ...headers,
    },
    ...(body === undefined ? {} : { data: body }),
  });
  const json = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  return { status: response.status(), json: json ?? {} };
}

/** challenge → sign (Node key) → the signed fields, as a wallet would produce them. */
export async function signed(
  request: APIRequestContext,
  ip: string,
  who: NodeSigner,
  challenge: Record<string, unknown>,
) {
  const issued = await api(request, ip, "POST", "/api/v1/creators/challenge", {
    wallet: who.wallet,
    ...challenge,
  });
  expect(issued.status, JSON.stringify(issued.json)).toBe(200);
  return {
    wallet: who.wallet,
    nonce: issued.json.nonce as string,
    signature: await who.sign(issued.json.message as string),
    basketId: issued.json.basketId as string | null,
  };
}

export async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: T; error?: unknown };
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result as T;
}

/** Send a signed transaction to the LOCAL FORK (as a Blink client would) and wait for it. */
export async function sendToFork(signedBase64: string): Promise<string> {
  const signature = await rpc<string>("sendTransaction", [
    signedBase64,
    { encoding: "base64", preflightCommitment: "confirmed" },
  ]);
  for (let i = 0; i < 60; i++) {
    const { value } = await rpc<{
      value: ({ confirmationStatus?: string; err: unknown } | null)[];
    }>("getSignatureStatuses", [[signature]]);
    const status = value[0];
    if (status?.err)
      throw new Error(`fork transaction failed: ${JSON.stringify(status.err)}`);
    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    )
      return signature;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("fork transaction did not confirm");
}

/** Build the creator basket in /v1/basket/new from LEGS, in order. */
export async function fillBuilder(page: Page, name: string, ticker: string) {
  await page.getByLabel("Basket name").fill(name);
  await page.getByLabel("Ticker").fill(ticker);
  const search = page.getByRole("searchbox");
  for (const leg of LEGS) {
    // Exact mint search: one result, never another issuer's same ticker.
    await search.fill(leg.mint);
    const option = page.getByRole("button", {
      name: new RegExp(`^${leg.symbol}\\b`),
    });
    await expect(option).toHaveCount(1);
    await option.click();
  }
  await search.fill("");
  await expect(
    page.getByText("Total is 100.00%. Ready to preview."),
  ).toBeVisible();
}
