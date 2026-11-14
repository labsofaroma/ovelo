import { expect, test, type APIRequestContext } from "@playwright/test";
import { walletTransactionSignature } from "../../lib/sdk/baskets/mainnet";
import { e2eWallet, rpc, USDC } from "../fork/accounts";
import { signAll } from "./wallet";

/**
 * M9 server RPC failover on the LOCAL FORK (docs/launch/PRODUCTION-ENV.md §3). The app talks to
 * the fork through two loopback proxies, its primary and its fallback (e2e/fork/rpc-proxy.ts);
 * this spec switches them while it trades through the API with the test wallet:
 * 1. a fallback on the wrong cluster is never used: with the primary down, the quote is refused;
 * 2. the primary stops between quote and submit: the order still confirms, with the exact signed
 *    bytes (the signature on chain is the signature of what the wallet signed);
 * 3. the primary forwards the send but drops the answer: the same bytes go to the fallback, and
 *    the order confirms once (one debit).
 * The server caches each endpoint's genesis verdict for 60 s, so case 1 runs first and the
 * others wait for its "wrong cluster" verdict to expire.
 */
const CONTROL = process.env.E2E_RPC_CONTROL ?? "http://127.0.0.1:18900";
const CHAIN = process.env.E2E_RPC_URL ?? "http://127.0.0.1:8899";
const BASKET = process.env.E2E_BASKET_ID ?? "sol-energy";
// Its own client IP, so this spec's quotes do not share a rate-limit window with the others.
const HEADERS = { "x-real-ip": "198.51.100.77" };
const taker = e2eWallet().publicKey.toBase58();

test.describe.configure({ mode: "serial" });

const mode = (name: "primary" | "fallback", value: string) =>
  fetch(`${CONTROL}/${name}/${value}`, { method: "POST" }).then((r) => {
    if (!r.ok) throw new Error(`proxy control ${name}/${value}: ${r.status}`);
  });

test.afterAll(async () => {
  await mode("primary", "forward");
  await mode("fallback", "forward");
});

/** sendTransaction requests each proxy has received so far. */
const sends = async () =>
  ((await (await fetch(CONTROL)).json()) as { sends: Record<string, number> })
    .sends;

async function quote(request: APIRequestContext) {
  return request.post("/api/v1/trade/quote", {
    headers: HEADERS,
    data: {
      target: { kind: "basket", basketId: BASKET },
      inputMint: USDC,
      amount: "2", // the recorded basket order (e2e/fork/run.ts)
      taker,
      supportedTransactionVersions: [0],
    },
  });
}

async function usdcBalance(): Promise<bigint> {
  const { value } = await rpc<{
    value: {
      account: {
        data: { parsed: { info: { tokenAmount: { amount: string } } } };
      };
    }[];
  }>(CHAIN, "getTokenAccountsByOwner", [
    taker,
    { mint: USDC },
    { encoding: "jsonParsed", commitment: "confirmed" },
  ]);
  return value.reduce(
    (sum, a) => sum + BigInt(a.account.data.parsed.info.tokenAmount.amount),
    0n,
  );
}

/** Quote → sign → (switch the proxies) → submit → poll until final. */
async function trade(
  request: APIRequestContext,
  beforeSubmit: () => Promise<void>,
) {
  const quoted = await quote(request);
  expect(quoted.status()).toBe(200);
  const body = (await quoted.json()) as {
    transactions: string[];
    authorization: string;
  };
  const signed = signAll(body.transactions);
  expect(signed).toHaveLength(1);
  const expectedSignature = await walletTransactionSignature(signed[0]!);
  await beforeSubmit();
  const submitted = await request.post("/api/v1/trade/submit", {
    headers: HEADERS,
    data: { authorization: body.authorization, signedTransactions: signed },
  });
  expect(submitted.status()).toBe(200);
  let record = (await submitted.json()) as {
    id: string;
    status: string;
    signatures: string[];
  };
  for (
    let i = 0;
    i < 40 && !["confirmed", "failed"].includes(record.status);
    i++
  ) {
    await new Promise((r) => setTimeout(r, 1500));
    record = await (
      await request.get(`/api/v1/trade/${record.id}`, { headers: HEADERS })
    ).json();
  }
  return { record, expectedSignature };
}

async function onChain(signature: string) {
  const { value } = await rpc<{
    value: ({ err: unknown; confirmationStatus: string } | null)[];
  }>(CHAIN, "getSignatureStatuses", [
    [signature],
    { searchTransactionHistory: true },
  ]);
  return value[0];
}

test("a fallback on the wrong cluster is never used: primary down, the quote is refused", async ({
  request,
}) => {
  await mode("fallback", "wrong-genesis");
  await mode("primary", "down");
  const before = await usdcBalance();
  const refused = await quote(request);
  expect(refused.status()).toBe(502);
  expect(await refused.json()).toEqual({
    code: "UPSTREAM_UNAVAILABLE",
    message: "An upstream service is unavailable.",
  });
  // Health reports the fallback as failing its genesis proof (facts only, no host).
  const health = (await (await request.get("/api/v1/health")).json()) as {
    checks: { rpc: Record<string, unknown> };
  };
  expect(health.checks.rpc).toMatchObject({
    primary: "fail",
    fallback: "fail",
  });
  expect(JSON.stringify(health)).not.toContain("127.0.0.1");
  expect(await usdcBalance()).toBe(before);
  await mode("primary", "forward");
  await mode("fallback", "forward");
});

test("the primary stops between quote and submit: the order confirms with the same signed bytes", async ({
  request,
}) => {
  test.setTimeout(240_000);
  // Let the server's 60 s "wrong cluster" verdict on the fallback (case 1) expire.
  await new Promise((r) => setTimeout(r, 61_000));
  const before = await usdcBalance();
  const sent = await sends();
  const { record, expectedSignature } = await trade(request, () =>
    mode("primary", "down"),
  );
  await mode("primary", "forward");
  // The primary was down for the whole submit: the one send went to the fallback.
  expect(await sends()).toEqual({
    primary: sent.primary,
    fallback: sent.fallback! + 1,
  });
  expect(record.status).toBe("confirmed");
  expect(record.signatures).toEqual([expectedSignature]);
  expect(await onChain(expectedSignature)).toMatchObject({ err: null });
  const spent = before - (await usdcBalance());
  expect(spent > 0n && spent <= 2_100_000n).toBe(true);
});

test("the primary drops the answer to a send: the same bytes go to the fallback, one debit", async ({
  request,
}) => {
  test.setTimeout(180_000);
  // Case 2 left the primary in the server's 30 s failover cooldown; wait it out so this quote
  // and submit use the primary again (otherwise the swallowing primary is never asked).
  await new Promise((r) => setTimeout(r, 31_000));
  const before = await usdcBalance();
  const sent = await sends();
  const { record, expectedSignature } = await trade(request, () =>
    mode("primary", "swallow-send"),
  );
  await mode("primary", "forward");
  // Exactly one send to each: the primary forwarded it and lost the answer, then the SAME bytes
  // went to the fallback (the record's signature is the signed bytes' signature, below).
  expect(await sends()).toEqual({
    primary: sent.primary! + 1,
    fallback: sent.fallback! + 1,
  });
  expect(record.status).toBe("confirmed");
  expect(record.signatures).toEqual([expectedSignature]);
  expect(await onChain(expectedSignature)).toMatchObject({ err: null });
  // Sent twice (primary, then fallback), executed once: one order's debit, never two.
  const spent = before - (await usdcBalance());
  expect(spent > 0n && spent <= 2_100_000n).toBe(true);
});
