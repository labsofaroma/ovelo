/**
 * LiteSVM world for the DEFAULT (mainnet) build (M8 B3). Real mainnet binaries (Jupiter v6,
 * Orca Whirlpool, Token, Token-2022, pinned in tests/fixtures/mainnet-programs.json), the real
 * USDC and xStocks mints and the Whirlpool pools of three recorded Jupiter routes
 * (jupiter-mainnet-routes.json), the pinned Subscriptions and Pyth receiver binaries, and the
 * Aroma Guard default build. Every keypair is generated in memory for one test.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  AccountRole,
  address,
  generateKeyPairSigner,
  lamports,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";
import { PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID as T22,
  getScaledUiAmountConfig,
  unpackMint,
} from "@solana/spl-token";
import * as v1 from "@aroma/guard";
import {
  Env,
  MAINNET_SO,
  PROGRAM_DIR,
  priceUpdateBytes,
  feed,
} from "../harness";
import { ataIx, configParams, cuLimit, DEFAULT } from "../helpers";

const root = path.resolve(import.meta.dirname, "../../..");
const fixture = (f: string) =>
  JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures", f), "utf8"));
type RecordedRoute = {
  symbol: string;
  mint: Address;
  amountIn: string;
  quotedOutAmount: string;
  accounts: { address: Address; writable: boolean }[];
  data: string;
};
export const ROUTES = fixture("jupiter-mainnet-routes.json") as {
  slot: number;
  blockTime: number;
  swapAuthority: Address;
  routes: RecordedRoute[];
  accounts: Record<string, { owner: string; lamports: number; data: string }>;
};
const PINS = fixture("mainnet-programs.json") as {
  programs: Record<string, { sha256: string }>;
};
export const USDC = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
/** xStocks issuer keys (mainnet read, aroma-guard-v1.md Token-2022 policy). */
export const ISSUER = address("5aMNNLQJwAEeoemTEMkv5NVjqKwvvefRYCQ5Z67HFvEq");
export const FREEZE = address("JDq14BWvqCRFNu1krb12bcRpbGtJZ1FLEakMw6FdxJNs");
export const HOUR = 3_600n;

function pinnedMainnet(id: string): Uint8Array {
  const bytes = fs.readFileSync(path.join(PROGRAM_DIR, "mainnet", `${id}.so`));
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  if (sha !== PINS.programs[id]?.sha256)
    throw new Error(
      `${id}.so is not the pinned mainnet binary; run test:fixtures:mainnet.`,
    );
  return bytes;
}

export type Stock = {
  symbol: string;
  mint: Address;
  feedId: Uint8Array;
  ownerAta: Address;
  recorded: RecordedRoute;
  /** Shares per token (ScaledUiAmount multiplier now). */
  multiplier: number;
};

export class MainnetWorld {
  constructor(
    public env: Env,
    public admin: KeyPairSigner,
    public keeper: KeyPairSigner,
    public owner: KeyPairSigner,
    public treasury: KeyPairSigner,
    public feeRecipient: KeyPairSigner,
    public ownerUsd: Address,
    public stocks: Stock[],
    public params: v1.ConfigParamsArgs,
  ) {}

  static async create(o: { feeBps?: number; keeper?: "none" } = {}) {
    const admin = await generateKeyPairSigner();
    const env = await Env.create(admin.address, MAINNET_SO);
    for (const id of Object.keys(PINS.programs))
      env.svm.addProgram(address(id), pinnedMainnet(id));
    for (const [key, a] of Object.entries(ROUTES.accounts))
      env.svm.setAccount({
        address: address(key),
        programAddress: address(a.owner),
        data: Buffer.from(a.data, "base64"),
        executable: false,
        lamports: lamports(BigInt(a.lamports)),
        space: BigInt(Buffer.from(a.data, "base64").length),
      });
    env.setClock(BigInt(ROUTES.blockTime));
    env.svm.airdrop(admin.address, lamports(100_000_000_000n));
    const [keeper, owner, treasury, feeRecipient] = [
      await env.signer(),
      await env.signer(),
      await env.signer(),
      await env.signer(),
    ];
    const ownerUsd = await env.classicAta(owner.address, USDC, 1_000_000_000n);
    await env.classicAta(treasury.address, USDC, 0n);
    await env.classicAta(feeRecipient.address, USDC, 0n);
    const base = configParams({
      admin: admin.address,
      keeper: o.keeper === "none" ? null : keeper.address,
      usd: USDC,
      treasury: treasury.address,
      feeRecipient: o.feeBps ? feeRecipient.address : DEFAULT,
      feeBps: o.feeBps ?? 0,
      window: 1,
      maxInstallment: 500_000_000n,
    });
    const four = (k: Address) => [k, DEFAULT, DEFAULT, DEFAULT];
    const params = {
      ...base,
      allowedFreezeAuthorities: four(FREEZE),
      allowedPermanentDelegates: four(ISSUER),
    };
    await env.send(admin, [
      await v1.buildInitializeConfigInstruction({ authority: admin, params }),
    ]);
    const world = new MainnetWorld(
      env,
      admin,
      keeper,
      owner,
      treasury,
      feeRecipient,
      ownerUsd,
      [],
      params,
    );
    for (const [i, recorded] of ROUTES.routes.entries())
      world.stocks.push(await world.addStock(recorded, 0xb0 + i));
    // The swap authority's USDC account and one transit account per stock (keeper-paid, once).
    await env.send(admin, [
      ...(await v1.swapAuthorityAccountInstructions(admin, [
        { mint: USDC, tokenProgram: v1.TOKEN_PROGRAM_ID },
        ...world.stocks.map((s) => ({
          mint: s.mint,
          tokenProgram: v1.TOKEN_2022_PROGRAM_ID,
        })),
      ])),
    ]);
    return world;
  }

  async addStock(recorded: RecordedRoute, feedByte: number): Promise<Stock> {
    const feedId = feed(feedByte);
    await this.env.send(this.admin, [
      await v1.buildRegisterAssetInstruction({
        admin: this.admin,
        mint: recorded.mint,
        tokenProgram: v1.TOKEN_2022_PROGRAM_ID,
        pythFeedId: feedId,
      }),
    ]);
    await this.env.send(this.owner, [ataIx(this.owner.address, recorded.mint)]);
    return {
      symbol: recorded.symbol,
      mint: recorded.mint,
      feedId,
      ownerAta: await v1.findAssociatedTokenAddress(
        this.owner.address,
        recorded.mint,
        v1.TOKEN_2022_PROGRAM_ID,
      ),
      recorded,
      multiplier: this.multiplier(recorded.mint),
    };
  }

  multiplier(mint: Address): number {
    const data = this.env.data(mint)!;
    const m = unpackMint(
      new PublicKey(mint),
      { data: Buffer.from(data), owner: T22, lamports: 0, executable: false },
      T22,
    );
    return getScaledUiAmountConfig(m)?.multiplier ?? 1;
  }

  /**
   * The oracle price (expo −5, USD per share) at which the recorded quote is the oracle value,
   * times `bias` (1.003 = oracle 0.3 % above the market quote, so the floor has headroom).
   */
  marketPrice(stock: Stock, bias = 1.003): bigint {
    const usd = Number(stock.recorded.amountIn) / 1e6;
    const shares =
      (Number(stock.recorded.quotedOutAmount) / 1e8) * stock.multiplier;
    return BigInt(Math.round((usd / shares) * bias * 1e5));
  }

  async postPrice(
    stock: Stock,
    o: { price?: bigint; conf?: bigint; publishTime?: bigint } = {},
  ) {
    const update = (await generateKeyPairSigner()).address;
    const price = o.price ?? this.marketPrice(stock);
    this.env.put(
      update,
      v1.PYTH_RECEIVER_PROGRAM_ID,
      priceUpdateBytes({
        feedId: stock.feedId,
        price,
        conf: o.conf ?? price / 10_000n,
        expo: -5,
        publishTime: o.publishTime ?? this.env.now,
      }),
    );
    return update;
  }

  async createPlan(
    o: {
      stocks?: Stock[];
      weights?: number[];
      amount?: bigint;
      periods?: number;
      nonce?: bigint;
      slippage?: number;
    } = {},
  ) {
    const stocks = o.stocks ?? this.stocks;
    const weights = o.weights ?? [5_000, 3_000, 2_000].slice(0, stocks.length);
    const nonce = o.nonce ?? 1n;
    const data = this.env.data(
      await v1.findSubscriptionAuthorityPda(this.owner.address, USDC),
    );
    await this.env.send(
      this.owner,
      await v1.buildCreatePlanInstructions({
        owner: this.owner,
        fundingMint: USDC,
        fundingTokenProgram: v1.TOKEN_PROGRAM_ID,
        nonce,
        fundingAmount: o.amount ?? 10_000_000n,
        periodSeconds: 24n * HOUR,
        startsAt: this.env.now,
        periods: o.periods ?? 4,
        outputs: stocks.map((s, i) => ({
          mint: s.mint,
          weightBps: weights[i]!,
          maxSlippageBps: o.slippage ?? 100,
        })),
        catchUpWindowPeriods: 1,
        subscriptionAuthorityInitId: data
          ? Buffer.from(data).readBigInt64LE(98)
          : null,
      }),
    );
    return v1.findPlanPda(this.owner.address, USDC, nonce);
  }

  plan(address: Address): v1.Plan {
    return v1.decodePlanAccount(this.env.data(address)!);
  }

  /** The recorded route with the owner's ATA as destination and `amountIn` re-encoded if asked. */
  route(stock: Stock, amountIn?: bigint): v1.JupiterRoute {
    const recorded = stock.recorded;
    const route: v1.JupiterRoute = {
      accounts: recorded.accounts.map((a, i) => ({
        address: i === v1.ROUTE_V2.destination ? stock.ownerAta : a.address,
        role: a.writable ? AccountRole.WRITABLE : AccountRole.READONLY,
      })),
      data: Uint8Array.from(Buffer.from(recorded.data, "base64")),
    };
    if (amountIn === undefined) return route;
    const quoted =
      (BigInt(recorded.quotedOutAmount) * amountIn) / BigInt(recorded.amountIn);
    return v1.withAmounts(route, amountIn, quoted);
  }

  async executeIxs(
    planAddress: Address,
    period: number,
    legMask: number,
    o: {
      keeper?: KeyPairSigner;
      prices?: Address[];
      routes?: v1.JupiterRoute[];
      stocks?: Stock[];
    } = {},
  ) {
    const plan = this.plan(planAddress);
    const fee = Number(this.params.protocolFeeBps);
    const legs = plan.outputs
      .map((_, i) => i)
      .filter((i) => (legMask >>> i) & 1);
    const stocks = o.stocks ?? this.stocks;
    const inputs = [];
    for (const [k, leg] of legs.entries()) {
      const stock = stocks.find((s) => s.mint === plan.outputs[leg]!.mint)!;
      const { amountIn } = v1.routedLegAmounts(plan, leg, fee);
      inputs.push({
        mint: stock.mint,
        tokenProgram: v1.TOKEN_2022_PROGRAM_ID,
        priceUpdate: o.prices?.[k] ?? (await this.postPrice(stock)),
        route:
          o.routes?.[k] ??
          this.route(
            stock,
            amountIn === BigInt(stock.recorded.amountIn) ? undefined : amountIn,
          ),
      });
    }
    return [
      cuLimit(1_400_000),
      await v1.buildExecuteInstallmentRoutedInstruction({
        keeper: o.keeper ?? this.keeper,
        planAddress,
        plan,
        treasury: this.treasury.address,
        feeRecipient: fee > 0 ? this.feeRecipient.address : null,
        protocolFeeBps: fee,
        period,
        legMask,
        legs: inputs,
      }),
    ];
  }

  async execute(
    planAddress: Address,
    period: number,
    legMask: number,
    o: Parameters<MainnetWorld["executeIxs"]>[3] = {},
  ) {
    return this.env.trySend(
      o.keeper ?? this.keeper,
      await this.executeIxs(planAddress, period, legMask, o),
    );
  }
}
