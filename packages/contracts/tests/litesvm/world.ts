/** Scenario builder: config, test USD, mock stocks, registered assets, plans, executions. */
import {
  generateKeyPairSigner,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import { SystemProgram } from "@solana/web3.js";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createInitializeScaledUiAmountConfigInstruction,
  getMintLen,
} from "@solana/spl-token";
import * as v1 from "../../../../apps/web/lib/sdk/guard/v1";
import {
  Env,
  feed,
  kitIx,
  pk,
  priceUpdateBytes,
  START,
  type PriceInput,
} from "./harness";
import { configParams, cuLimit, DEFAULT, evenWeights } from "./helpers";

export {
  ataIx,
  configParams,
  cuLimit,
  DEFAULT,
  errorCode,
  evenWeights,
} from "./helpers";

export type Stock = {
  mint: Address;
  feedId: Uint8Array;
  decimals: number;
  ownerAta: Address;
};

export type WorldOptions = {
  stocks?: number;
  multipliers?: number[];
  window?: number;
  feeBps?: number;
  anyoneCanExecute?: boolean;
  maxInstallment?: bigint;
  /** Program binary (default: the devnet-mock build). */
  soPath?: string;
};

export class World {
  constructor(
    public env: Env,
    public admin: KeyPairSigner,
    public keeper: KeyPairSigner,
    public owner: KeyPairSigner,
    public treasury: KeyPairSigner,
    public feeRecipient: KeyPairSigner,
    public usd: Address,
    public ownerUsd: Address,
    public stocks: Stock[],
    public params: v1.ConfigParamsArgs,
  ) {}

  static async create(o: WorldOptions = {}): Promise<World> {
    const admin = await generateKeyPairSigner();
    const env = await Env.create(admin.address, o.soPath);
    env.svm.airdrop(admin.address, 100_000_000_000n as never);
    const [keeper, owner, treasury, feeRecipient] = [
      await env.signer(),
      await env.signer(),
      await env.signer(),
      await env.signer(),
    ];
    const usd = (await generateKeyPairSigner()).address;
    env.classicMint(usd, 6, admin.address);
    const ownerUsd = await env.classicAta(owner.address, usd, 1_000_000_000n);
    await env.classicAta(treasury.address, usd, 0n);
    await env.classicAta(feeRecipient.address, usd, 0n);
    const params = configParams({
      admin: admin.address,
      keeper: o.anyoneCanExecute ? null : keeper.address,
      usd,
      treasury: treasury.address,
      feeRecipient: o.feeBps ? feeRecipient.address : DEFAULT,
      feeBps: o.feeBps ?? 0,
      window: o.window ?? 1,
      maxInstallment: o.maxInstallment ?? 500_000_000n,
    });
    await env.send(admin, [
      await v1.buildInitializeConfigInstruction({ authority: admin, params }),
    ]);
    const world = new World(
      env,
      admin,
      keeper,
      owner,
      treasury,
      feeRecipient,
      usd,
      ownerUsd,
      [],
      params,
    );
    for (let i = 0; i < (o.stocks ?? 3); i += 1) {
      world.stocks.push(
        await world.addStock({
          multiplier: o.multipliers?.[i] ?? 1,
          feedByte: 0xa0 + i,
        }),
      );
    }
    return world;
  }

  /** Token-2022 mock stock (8 dp, ScaledUiAmount) whose mint authority is its mock PDA. */
  /** `multiplier: null` creates the mint without ScaledUiAmount (some extensions exclude it). */
  async mockMint(
    multiplier: number | null,
    decimals = 8,
    extraInit: (mint: Address) => Instruction[] = () => [],
    extensions: ExtensionType[] = [],
  ) {
    const mint = await generateKeyPairSigner();
    const authority = await v1.findMockMintAuthorityPda(mint.address);
    const exts =
      multiplier === null
        ? extensions
        : [ExtensionType.ScaledUiAmountConfig, ...extensions];
    const space = getMintLen(exts);
    const rent = this.env.svm.minimumBalanceForRentExemption(BigInt(space));
    const ixs = [
      kitIx(
        SystemProgram.createAccount({
          fromPubkey: pk(this.admin.address),
          newAccountPubkey: pk(mint.address),
          space,
          lamports: Number(rent),
          programId: TOKEN_2022_PROGRAM_ID,
        }),
        [this.admin, mint],
      ),
      ...(multiplier === null
        ? []
        : [
            kitIx(
              createInitializeScaledUiAmountConfigInstruction(
                pk(mint.address),
                pk(this.admin.address),
                multiplier,
                TOKEN_2022_PROGRAM_ID,
              ),
            ),
          ]),
      ...extraInit(mint.address),
      kitIx(
        createInitializeMint2Instruction(
          pk(mint.address),
          decimals,
          pk(authority),
          null,
          TOKEN_2022_PROGRAM_ID,
        ),
      ),
    ];
    await this.env.send(this.admin, ixs);
    return mint.address;
  }

  async register(
    mint: Address,
    feedId: Uint8Array,
    tokenProgram: Address = v1.TOKEN_2022_PROGRAM_ID,
  ) {
    return this.env.trySend(this.admin, [
      await v1.buildRegisterAssetInstruction({
        admin: this.admin,
        mint,
        tokenProgram,
        pythFeedId: feedId,
      }),
    ]);
  }

  async addStock(o: { multiplier: number; feedByte: number }): Promise<Stock> {
    const mint = await this.mockMint(o.multiplier);
    const feedId = feed(o.feedByte);
    const registered = await this.register(mint, feedId);
    if (!registered.ok) throw new Error(registered.logs.join("\n"));
    const ownerAta = await v1.findAssociatedTokenAddress(
      this.owner.address,
      mint,
      v1.TOKEN_2022_PROGRAM_ID,
    );
    await this.env.send(this.owner, [
      kitIx(
        createAssociatedTokenAccountIdempotentInstruction(
          pk(this.owner.address),
          pk(ownerAta),
          pk(this.owner.address),
          pk(mint),
          TOKEN_2022_PROGRAM_ID,
        ),
      ),
    ]);
    return { mint, feedId, decimals: 8, ownerAta };
  }

  /** The owner's SubscriptionAuthority `init_id` for test USD, or null before the first plan. */
  async authorityInitId(): Promise<bigint | null> {
    const data = this.env.data(
      await v1.findSubscriptionAuthorityPda(this.owner.address, this.usd),
    );
    return data ? Buffer.from(data).readBigInt64LE(98) : null;
  }

  async createPlanIxs(o: {
    nonce?: bigint;
    amount?: bigint;
    period?: bigint;
    periods?: number;
    weights?: number[];
    slippage?: number;
    startsAt?: bigint;
    stocks?: Stock[];
    initId?: bigint | null;
  }) {
    const stocks = o.stocks ?? this.stocks;
    const weights = o.weights ?? evenWeights(stocks.length);
    return v1.buildCreatePlanInstructions({
      owner: this.owner,
      fundingMint: this.usd,
      fundingTokenProgram: v1.TOKEN_PROGRAM_ID,
      nonce: o.nonce ?? 1n,
      fundingAmount: o.amount ?? 30_000_000n,
      periodSeconds: o.period ?? 86_400n,
      startsAt: o.startsAt ?? this.env.now,
      periods: o.periods ?? 4,
      outputs: stocks.map((s, i) => ({
        mint: s.mint,
        weightBps: weights[i] ?? 0,
        maxSlippageBps: o.slippage ?? 100,
      })),
      catchUpWindowPeriods: Number(this.params.catchUpWindowPeriods),
      subscriptionAuthorityInitId: o.initId === undefined ? null : o.initId,
    });
  }

  async createPlan(o: Parameters<World["createPlanIxs"]>[0] = {}) {
    await this.env.send(this.owner, await this.createPlanIxs(o));
    const plan = await v1.findPlanPda(
      this.owner.address,
      this.usd,
      o.nonce ?? 1n,
    );
    return plan;
  }

  plan(address: Address): v1.Plan {
    const data = this.env.data(address);
    if (!data) throw new Error("plan missing");
    return v1.decodePlanAccount(data);
  }

  /** Writes one receiver-owned PriceUpdateV2 per stock; returns their addresses. */
  async postPrices(
    stocks: Stock[],
    p: Partial<PriceInput> & { prices?: bigint[] } = {},
  ) {
    const out: Address[] = [];
    for (const [i, s] of stocks.entries()) {
      const update = (await generateKeyPairSigner()).address;
      this.env.put(
        update,
        v1.PYTH_RECEIVER_PROGRAM_ID,
        priceUpdateBytes({
          feedId: p.feedId ?? s.feedId,
          price: p.prices?.[i] ?? p.price ?? 20_000_000n, // $200.00000
          conf: p.conf ?? 10_000n, // $0.10
          expo: p.expo ?? -5,
          publishTime: p.publishTime ?? this.env.now,
          full: p.full,
        }),
      );
      out.push(update);
    }
    return out;
  }

  async executeIxs(
    planAddress: Address,
    period: number,
    legMask: number,
    o: {
      keeper?: KeyPairSigner;
      prices?: Address[];
      stocks?: Stock[];
      noFeeAccount?: boolean;
    } = {},
  ) {
    const plan = this.plan(planAddress);
    const legStocks = (o.stocks ?? this.stocks).filter(
      (_, i) => (legMask >>> i) & 1,
    );
    const prices = o.prices ?? (await this.postPrices(legStocks));
    const ix = await v1.buildExecuteInstallmentInstruction({
      keeper: o.keeper ?? this.keeper,
      planAddress,
      plan,
      treasury: this.treasury.address,
      feeRecipient:
        o.noFeeAccount || Number(this.params.protocolFeeBps) === 0
          ? null
          : this.feeRecipient.address,
      period,
      legMask,
      legs: legStocks.map((s, k) => ({
        mint: s.mint,
        tokenProgram: v1.TOKEN_2022_PROGRAM_ID,
        priceUpdate: prices[k]!,
      })),
    });
    return [cuLimit(1_400_000), ix];
  }

  async execute(
    planAddress: Address,
    period: number,
    legMask: number,
    o: Parameters<World["executeIxs"]>[3] = {},
  ) {
    return this.env.trySend(
      o.keeper ?? this.keeper,
      await this.executeIxs(planAddress, period, legMask, o),
    );
  }

  at(offsetSeconds: bigint) {
    this.env.setClock(START + offsetSeconds);
  }
}
