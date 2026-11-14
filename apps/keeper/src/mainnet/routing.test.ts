import { describe, expect, it } from "vitest";
import { address, generateKeyPairSigner, getAddressEncoder } from "@solana/kit";
import {
  findAssociatedTokenAddress,
  swapAccountsFor,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@aroma/guard";
import { fakeKeeperChain } from "../test/chain";
import { fakeJupiterFetch, QUOTED, type BuildCall } from "../test/jupiter";
import { JITO_TIP_ACCOUNTS, jitoSubmitter, jitoTipInstruction } from "./jito";
import {
  directRoute,
  jupiterClient,
  jupiterSlippage,
  type JupiterUnavailable,
} from "./jupiter";
import {
  decodeLookupTable,
  LOOKUP_TABLE_PROGRAM,
  LookupTableRejected,
  mergeLookupTables,
  verifiedLookupTables,
} from "./lookup-tables";

const USDC = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const STOCK = address("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");

async function request() {
  const owner = (await generateKeyPairSigner()).address;
  const swap = await swapAccountsFor({
    fundingMint: USDC,
    fundingTokenProgram: TOKEN_PROGRAM_ID,
    outputMint: STOCK,
    outputTokenProgram: TOKEN_2022_PROGRAM_ID,
  });
  return {
    inputMint: USDC,
    outputMint: STOCK,
    inputTokenProgram: TOKEN_PROGRAM_ID,
    outputTokenProgram: TOKEN_2022_PROGRAM_ID,
    amountIn: 5_000_000n,
    swapAuthority: swap.authority,
    source: swap.source,
    destination: await findAssociatedTokenAddress(
      owner,
      STOCK,
      TOKEN_2022_PROGRAM_ID,
    ),
    slippageBps: 100,
  };
}

describe("Jupiter build client", () => {
  it("asks for the swap authority as taker and the owner's ATA as destination; validates with M4's code", async () => {
    const calls: BuildCall[] = [];
    const leg = await request();
    const client = jupiterClient({
      baseUrl: "https://api.jup.ag/",
      apiKey: "k",
      fetch: fakeJupiterFetch({ calls }),
    });
    const built = await client.build(leg);
    expect(calls[0]).toMatchObject({
      taker: leg.swapAuthority,
      destinationTokenAccount: leg.destination,
      amount: "5000000",
      slippageBps: "100",
      wrapAndUnwrapSol: "false",
    });
    expect(built.quotedOut).toBe(QUOTED);
    expect(built.route.accounts[7]!.address).toBe(leg.destination);
    expect(
      built.route.accounts.every((a) => a.role === 0 || a.role === 1),
    ).toBe(true);
  });

  it("retries 429 with backoff, then reports rate limiting; maps no-route, HTTP and invalid builds", async () => {
    const leg = await request();
    const sleeps: number[] = [];
    const sleep = async (ms: number) => void sleeps.push(ms);
    const ok = await jupiterClient({
      baseUrl: "x://j",
      fetch: fakeJupiterFetch({ status: [429, 429] }),
      sleep,
    }).build(leg);
    expect(ok.quotedOut).toBe(QUOTED);
    expect(sleeps).toEqual([1_000, 2_000]);
    const kind = async (fetch: typeof globalThis.fetch) =>
      jupiterClient({ baseUrl: "x://j", fetch, sleep, maxAttempts: 2 })
        .build(leg)
        .then(
          () => "ok",
          (e: JupiterUnavailable) => e.kind,
        );
    expect(await kind(fakeJupiterFetch({ status: [429, 429] }))).toBe(
      "rate_limited",
    );
    expect(await kind(fakeJupiterFetch({ status: [400] }))).toBe("no_route");
    expect(await kind(fakeJupiterFetch({ status: [500] }))).toBe("http");
    expect(
      await kind(fakeJupiterFetch({ body: () => ({ outAmount: "1" }) })),
    ).toBe("invalid");
    expect(
      await kind((async () => {
        throw new Error("down");
      }) as never),
    ).toBe("unreachable");
    // A build whose destination is not the owner's ATA fails M4's settlement check.
    const other = await request();
    const wrong = fakeJupiterFetch();
    const redirect = (async (url: string) => {
      const u = new URL(url);
      u.searchParams.set("destinationTokenAccount", other.destination);
      return wrong(u.toString());
    }) as typeof fetch;
    expect(await kind(redirect)).toBe("invalid");
  });

  it("asks for direct routes and refuses a route through an intermediate mint", async () => {
    const calls: BuildCall[] = [];
    const leg = await request();
    const plain = fakeJupiterFetch({ calls });
    await jupiterClient({ baseUrl: "x://j", fetch: plain }).build(leg);
    expect(calls[0]!.onlyDirectRoutes).toBe("true");
    const hop = (async (url: string) => {
      const body = (await (await plain(url)).json()) as Record<string, unknown>;
      body.routePlan = [
        { swapInfo: { inputMint: USDC, outputMint: TOKEN_PROGRAM_ID } },
        { swapInfo: { inputMint: TOKEN_PROGRAM_ID, outputMint: STOCK } },
      ];
      return new Response(JSON.stringify(body));
    }) as typeof fetch;
    await expect(
      jupiterClient({ baseUrl: "x://j", fetch: hop }).build(leg),
    ).rejects.toThrow(/intermediate mint/);
    expect(directRoute([], USDC, STOCK)).toBe(false);
    expect(directRoute(undefined, USDC, STOCK)).toBe(false);
  });

  it("clamps Jupiter's own slippage to M4's reviewed range", () => {
    expect([
      jupiterSlippage(0),
      jupiterSlippage(100),
      jupiterSlippage(2_000),
    ]).toEqual([1, 100, 300]);
  });
});

describe("lookup tables", () => {
  const enc = getAddressEncoder();
  const table = (
    addresses: string[],
    deactivation = 0xffff_ffff_ffff_ffffn,
  ) => {
    const data = new Uint8Array(56 + 32 * addresses.length);
    const view = new DataView(data.buffer);
    view.setUint32(0, 1, true);
    view.setBigUint64(4, deactivation, true);
    addresses.forEach((a, i) => data.set(enc.encode(address(a)), 56 + 32 * i));
    return data;
  };
  const key = "GZVNhRASMzMKyP5ea3pDmakoqo4qFTXUmh4vbEuoS93W";

  it("decodes, merges and verifies against the chain", async () => {
    expect(decodeLookupTable(table([USDC, STOCK])).addresses).toEqual([
      USDC,
      STOCK,
    ]);
    expect(() => decodeLookupTable(new Uint8Array(10))).toThrow(
      LookupTableRejected,
    );
    expect(
      mergeLookupTables([{ [key]: [USDC] }, { [key]: [USDC, STOCK] }]).get(key),
    ).toEqual([USDC, STOCK]);
    expect(() =>
      mergeLookupTables([{ [key]: [USDC] }, { [key]: [STOCK] }]),
    ).toThrow(/inconsistent/);
    const chain = fakeKeeperChain();
    expect(await verifiedLookupTables(chain.rpc, [])).toEqual({});
    chain.accounts.set(key, {
      owner: LOOKUP_TABLE_PROGRAM,
      data: table([USDC, STOCK]),
    });
    expect(await verifiedLookupTables(chain.rpc, [{ [key]: [USDC] }])).toEqual({
      [key]: [USDC, STOCK],
    });
    await expect(
      verifiedLookupTables(chain.rpc, [{ [key]: [STOCK] }]),
    ).rejects.toThrow(/changed/);
    chain.accounts.set(key, {
      owner: LOOKUP_TABLE_PROGRAM,
      data: table([USDC], 5n),
    });
    await expect(
      verifiedLookupTables(chain.rpc, [{ [key]: [USDC] }]),
    ).rejects.toThrow(/deactivated/);
    chain.accounts.set(key, { owner: TOKEN_PROGRAM_ID, data: table([USDC]) });
    await expect(
      verifiedLookupTables(chain.rpc, [{ [key]: [USDC] }]),
    ).rejects.toThrow(/not owned/);
    const many = Object.fromEntries(
      Array.from({ length: 33 }, (_, i) => [String(i), []]),
    );
    expect(() => mergeLookupTables([many])).toThrow(/too many/);
  });
});

describe("Jito", () => {
  it("tips a published tip account and submits through the block engine", async () => {
    const payer = await generateKeyPairSigner();
    const tip = jitoTipInstruction(payer, 10_000n, 0);
    expect(tip.accounts![1]!.address).toBe(JITO_TIP_ACCOUNTS[0]);
    expect(Buffer.from(tip.data!).readBigUInt64LE(4)).toBe(10_000n);
    const bodies: string[] = [];
    const submit = jitoSubmitter(
      "https://jito.example/api/v1/transactions",
      (async (_u: string, init: RequestInit) => {
        bodies.push(String(init.body));
        return new Response(JSON.stringify({ result: "sig" }));
      }) as typeof fetch,
    );
    expect(await submit("d2lyZQ==")).toBe("sig");
    expect(JSON.parse(bodies[0]!).method).toBe("sendTransaction");
    const failing = jitoSubmitter(
      "https://j",
      (async () => new Response("{}", { status: 500 })) as typeof fetch,
    );
    await expect(failing("x")).rejects.toThrow(/Jito sendTransaction failed/);
  });
});
