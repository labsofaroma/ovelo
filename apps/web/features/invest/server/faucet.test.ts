import {
  createKeyPairSignerFromBytes,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  signBytes,
} from "@solana/kit";
import { describe, expect, it, vi } from "vitest";
import { faucetMessage } from "../schema";
import {
  claimTestTokens,
  FAUCET_LAMPORTS,
  FAUCET_TEST_USD_RAW,
  isMintAuthority,
  type FaucetDeps,
} from "./faucet";
import { claimFaucet, IP_CLAIMS_PER_DAY } from "./faucet-limits";
import { memoryRedis } from "./test-redis";
import { mintData, world } from "./test-world";
import { verifyTurnstile } from "./turnstile";

const NOW = new Date("2026-11-14T12:00:00Z");
const issuedAt = String(Math.floor(NOW.getTime() / 1000));
const passing = vi.fn(async () =>
  Response.json({ success: true, hostname: "localhost" }),
);
const failing = vi.fn(async () =>
  Response.json({ success: false, "error-codes": ["invalid-input-response"] }),
);

/** A 64-byte key generated at runtime (never committed): seed ‖ public key. */
async function freshKey(): Promise<Uint8Array> {
  const { privateKey, publicKey } = (await crypto.subtle.generateKey(
    "Ed25519",
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", privateKey),
  );
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", publicKey));
  return Uint8Array.from([...pkcs8.slice(-32), ...raw]);
}

async function setup(options: { lowSol?: boolean } = {}) {
  const faucetKey = await freshKey();
  const faucet = await createKeyPairSignerFromBytes(faucetKey);
  const w = await world({ faucetAuthority: faucet.address });
  if (!options.lowSol)
    w.chain.accounts.set(w.owner.address, {
      owner: "11111111111111111111111111111111",
      data: new Uint8Array(0),
      lamports: 2n * FAUCET_LAMPORTS,
    });
  else w.chain.accounts.delete(w.owner.address);
  const redis = memoryRedis();
  const sign = async (wallet = w.owner, at = issuedAt) =>
    Buffer.from(
      await signBytes(
        wallet.keyPair.privateKey,
        new TextEncoder().encode(faucetMessage(wallet.address, at, "devnet")),
      ),
    ).toString("base64");
  const deps: FaucetDeps = {
    network: w.network,
    rpc: w.chain.rpc,
    redis,
    faucetKey,
    turnstileSecret: "1x0000000000000000000000000000000AA",
    dailyClaims: 200,
    ip: "203.0.113.7",
    now: () => NOW,
    fetch: passing as unknown as typeof fetch,
  };
  return { w, faucet, redis, deps, sign };
}

const body = async (s: Awaited<ReturnType<typeof setup>>, overrides = {}) => ({
  wallet: s.w.owner.address,
  turnstileToken: "XXXX.DUMMY.TOKEN",
  issuedAt,
  signature: await s.sign(),
  ...overrides,
});

function sentInstructions(wire: string) {
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(wire));
  const message = getCompiledTransactionMessageDecoder().decode(
    tx.messageBytes,
  );
  return {
    feePayer: message.staticAccounts[0],
    datas: ("instructions" in message ? message.instructions : []).map(
      (ix) => [...(ix.data ?? [])][0],
    ),
  };
}

describe("faucet", () => {
  it("mints the fixed test USD amount, signed by the faucet key, and tops up SOL only when the wallet is low", async () => {
    const s = await setup({ lowSol: true });
    const result = await claimTestTokens(s.deps, await body(s));
    expect(result).toMatchObject({
      wallet: s.w.owner.address,
      testUsdRaw: FAUCET_TEST_USD_RAW.toString(),
      lamports: FAUCET_LAMPORTS.toString(),
      cluster: "devnet",
    });
    const sent = sentInstructions(s.w.chain.sent[0]!);
    expect(sent.feePayer).toBe(s.faucet.address);
    expect(sent.datas).toEqual([1, 7, 2]); // ATA create-idempotent, MintTo, Transfer
    const rich = await setup();
    expect((await claimTestTokens(rich.deps, await body(rich))).lamports).toBe(
      "0",
    );
    expect(sentInstructions(rich.w.chain.sent[0]!).datas).toEqual([1, 7]);
  });

  it("refuses a bad wallet signature, an expired claim and a failed Turnstile check before sending", async () => {
    const s = await setup();
    const other = s.w.keeper;
    await expect(
      claimTestTokens(
        s.deps,
        await body(s, { signature: await s.sign(other) }),
      ),
    ).rejects.toMatchObject({ code: "SIGNATURE_INVALID" });
    const old = String(Number(issuedAt) - 600);
    await expect(
      claimTestTokens(
        s.deps,
        await body(s, {
          issuedAt: old,
          signature: await s.sign(s.w.owner, old),
        }),
      ),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      claimTestTokens(
        { ...s.deps, fetch: failing as unknown as typeof fetch },
        await body(s),
      ),
    ).rejects.toMatchObject({ code: "CAPTCHA_FAILED" });
    expect(s.w.chain.sent).toHaveLength(0);
    expect(s.redis.store.size).toBe(0);
  });

  it("one claim per wallet per day; the IP and daily budgets hold; a failed send releases the claim", async () => {
    const s = await setup();
    await claimTestTokens(s.deps, await body(s));
    await expect(claimTestTokens(s.deps, await body(s))).rejects.toMatchObject({
      code: "FAUCET_LIMITED",
    });
    const limited = memoryRedis();
    for (let i = 0; i < IP_CLAIMS_PER_DAY; i += 1)
      await claimFaucet(limited, {
        wallet: `w${i}`,
        ip: "1.2.3.4",
        dailyClaims: 100,
        now: NOW,
      });
    await expect(
      claimFaucet(limited, {
        wallet: "w9",
        ip: "1.2.3.4",
        dailyClaims: 100,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "FAUCET_LIMITED" });
    expect(limited.store.has("faucet:wallet:w9")).toBe(false);
    await claimFaucet(limited, {
      wallet: "a",
      ip: "5.6.7.8",
      dailyClaims: 4,
      now: NOW,
    });
    await expect(
      claimFaucet(limited, {
        wallet: "b",
        ip: "9.9.9.9",
        dailyClaims: 4,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "FAUCET_EXHAUSTED" });
    const f = await setup();
    f.w.chain.fail.add("sendTransaction");
    await expect(claimTestTokens(f.deps, await body(f))).rejects.toMatchObject({
      code: "TRANSACTION_FAILED",
    });
    expect(f.redis.store.has(`faucet:wallet:${f.w.owner.address}`)).toBe(false);
  });

  it("refuses to run when the faucet key does not hold the test USD mint authority", async () => {
    const s = await setup();
    s.w.chain.accounts.set(s.w.usd.address, {
      owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      data: mintData(s.w.admin.address, 6),
    });
    await expect(claimTestTokens(s.deps, await body(s))).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    expect(isMintAuthority(mintData(null, 6), s.faucet.address)).toBe(false);
  });
});

describe("verifyTurnstile", () => {
  it("passes, fails with CAPTCHA_FAILED, and reports Cloudflare outages as UPSTREAM_UNAVAILABLE", async () => {
    const seen: URLSearchParams[] = [];
    const capture = vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(init.body as URLSearchParams);
      return Response.json({
        success: true,
        hostname: "ovelo.test",
        action: "faucet",
      });
    });
    await expect(
      verifyTurnstile({
        secret: "s",
        token: "t",
        remoteIp: "203.0.113.7",
        fetch: capture as unknown as typeof fetch,
      }),
    ).resolves.toEqual({ hostname: "ovelo.test", action: "faucet" });
    expect(seen[0]!.get("remoteip")).toBe("203.0.113.7");
    await verifyTurnstile({
      secret: "s",
      token: "t",
      remoteIp: "local",
      fetch: capture as unknown as typeof fetch,
    });
    expect(seen[1]!.has("remoteip")).toBe(false);
    await expect(
      verifyTurnstile({
        secret: "s",
        token: "t",
        fetch: failing as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "CAPTCHA_FAILED" });
    const down = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(
      verifyTurnstile({
        secret: "s",
        token: "t",
        fetch: down as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    const html = vi.fn(async () => new Response("<html>", { status: 502 }));
    await expect(
      verifyTurnstile({
        secret: "s",
        token: "t",
        fetch: html as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });
});
