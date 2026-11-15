import { FUNDING_TOKENS, USDC_MINT } from "../../trade/schema";
import type { Fixed } from "../../shared/fixed";
import type { Holding } from "../schema";
import { sumFixed, valueOf } from "../valuation";
import type { Fills } from "./fills";
import { apply, EMPTY, share, type Position } from "./ledger";
import {
  pnlViewSchema,
  type BasisStatus,
  type BasketPnl,
  type PnlRow,
  type PnlView,
} from "./schema";

/**
 * Receipts + exact fills + chain balances → P&L (M11 Step 2). For each token:
 * 1. replay this wallet's CONFIRMED Ovelo purchases as average-cost buys (quantity = exact fill,
 *    cost = the leg's exact USDC input), oldest first;
 * 2. reconcile with the balance on chain now: holding MORE than Ovelo bought → "outside" (cost
 *    basis unknown); holding LESS → the difference left the wallet (a sale or transfer Ovelo did
 *    not see), removed at average cost (ledger.ts);
 * 3. value what is held at the snapshot price; unrealized = value − remaining cost.
 */
export type ReceiptInput = {
  signature: string;
  kind: string;
  status: string;
  mintIn: string;
  createdAt: Date;
  legs: {
    mint: string;
    inputAmount: string;
    basket: string | null;
    requestId: string | null;
  }[];
};

const USDC_DECIMALS = 6;
const FUNDING = new Set<string>(FUNDING_TOKENS.map((t) => t.mint));

type MintState = {
  position: Position;
  flag: BasisStatus | null;
  bought: bigint;
};

function scaled(value: Fixed, decimals: number): bigint {
  return BigInt(value.raw) * 10n ** BigInt(decimals - value.decimals);
}

/** value − cost (USDC, 6 decimals) at the larger precision; bps of cost, truncated. */
export function unrealizedOf(value: Fixed, costUsdc: bigint) {
  const decimals = Math.max(value.decimals, USDC_DECIMALS);
  const diff =
    scaled(value, decimals) -
    costUsdc * 10n ** BigInt(decimals - USDC_DECIMALS);
  const costScaled = costUsdc * 10n ** BigInt(decimals - USDC_DECIMALS);
  return {
    unrealized: { raw: diff.toString(), decimals },
    bps: costScaled > 0n ? Number((diff * 10_000n) / costScaled) : null,
  };
}

export function buildPnl(input: {
  holdings: readonly Holding[];
  receipts: readonly ReceiptInput[];
  fills: ReadonlyMap<string, Fills>;
  basketName: (ref: string) => string;
}): PnlView {
  const states = new Map<string, MintState>();
  const state = (mint: string) => {
    let s = states.get(mint);
    if (!s) states.set(mint, (s = { position: EMPTY, flag: null, bought: 0n }));
    return s;
  };
  const basketLegs = new Map<
    string,
    {
      orders: Set<string>;
      legs: { mint: string; qty: bigint; cost: bigint }[];
      flag: BasisStatus | null;
    }
  >();
  const confirmed = input.receipts
    .filter(
      (r) =>
        r.status === "confirmed" && (r.kind === "spot" || r.kind === "basket"),
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const receipt of confirmed) {
    const fills = input.fills.get(receipt.signature);
    for (const leg of receipt.legs) {
      const s = state(leg.mint);
      const filled = fills?.[leg.mint];
      const flag: BasisStatus | null = !fills
        ? "fill_pending"
        : receipt.mintIn !== USDC_MINT
          ? "other_funding"
          : !filled
            ? "fill_pending"
            : null;
      if (flag) s.flag ??= flag;
      else {
        s.position = apply(s.position, {
          kind: "buy",
          quantity: BigInt(filled!),
          cost: BigInt(leg.inputAmount),
        });
        s.bought += BigInt(filled!);
      }
      if (receipt.kind === "basket" && leg.basket) {
        let group = basketLegs.get(leg.basket);
        if (!group)
          basketLegs.set(
            leg.basket,
            (group = { orders: new Set(), legs: [], flag: null }),
          );
        group.orders.add(leg.requestId ?? receipt.signature);
        if (flag) group.flag ??= flag;
        else
          group.legs.push({
            mint: leg.mint,
            qty: BigInt(filled!),
            cost: BigInt(leg.inputAmount),
          });
      }
    }
  }

  const held = new Map(input.holdings.map((h) => [h.mint, h]));
  const rows: PnlRow[] = input.holdings.map((holding) => {
    const balance = BigInt(holding.raw);
    const s = states.get(holding.mint);
    let status: BasisStatus = FUNDING.has(holding.mint)
      ? "funding"
      : !s
        ? "none"
        : (s.flag ?? (balance > s.position.quantity ? "outside" : "known"));
    if (status === "known" && s && balance < s.position.quantity)
      s.position = apply(s.position, {
        kind: "transfer_out",
        quantity: s.position.quantity - balance,
      });
    if (status === "known" && s && s.position.quantity === 0n) status = "none";
    const cost = status === "known" ? s!.position.cost : null;
    const pnl =
      cost !== null && holding.value ? unrealizedOf(holding.value, cost) : null;
    return {
      mint: holding.mint,
      symbol: holding.symbol,
      decimals: holding.decimals,
      quantity: holding.raw,
      status,
      costUsdc: cost === null ? null : cost.toString(),
      value: holding.value,
      priceSource: holding.priceSource,
      priceObservedAt: holding.priceObservedAt,
      unrealized: pnl?.unrealized ?? null,
      unrealizedBps: pnl?.bps ?? null,
    };
  });

  const baskets: BasketPnl[] = [...basketLegs].map(([ref, group]) => {
    let missing: BasketPnl["missing"] = group.flag;
    let cost = 0n;
    const values: Fixed[] = [];
    for (const leg of group.legs) {
      const row = rows.find((r) => r.mint === leg.mint);
      const s = states.get(leg.mint)!;
      if (!row || row.status !== "known") {
        missing ??= row?.status ?? "none";
        continue;
      }
      const holding = held.get(leg.mint)!;
      // The basket's share of what is still held, at the token's average (ledger.ts).
      const qty = share(leg.qty, s.position.quantity, s.bought);
      cost += share(leg.cost, s.position.quantity, s.bought);
      const v = valueOf(qty.toString(), holding.decimals, holding.price);
      if (v) values.push(v);
      else missing ??= "unpriced";
    }
    const total = sumFixed(values, USDC_DECIMALS);
    const shown = missing === null;
    const pnl = shown ? unrealizedOf(total, cost) : null;
    return {
      basket: ref,
      name: input.basketName(ref),
      orders: group.orders.size,
      costUsdc: shown ? cost.toString() : null,
      value: shown ? total : null,
      unrealized: pnl?.unrealized ?? null,
      unrealizedBps: pnl?.bps ?? null,
      missing,
    };
  });

  const included = rows.filter(
    (r) => r.status === "known" && r.value && r.costUsdc !== null,
  );
  const totalCost = included.reduce((sum, r) => sum + BigInt(r.costUsdc!), 0n);
  const decimals = included.reduce(
    (max, r) => Math.max(max, r.value!.decimals),
    USDC_DECIMALS,
  );
  const totalValue = included.reduce(
    (sum, r) => sum + scaled(r.value!, decimals),
    0n,
  );
  const totals = unrealizedOf(
    { raw: totalValue.toString(), decimals },
    totalCost,
  );
  return pnlViewSchema.parse({
    method: "average-cost",
    rows,
    baskets,
    totals: {
      included: included.length,
      excluded:
        rows.filter((r) => r.status !== "funding").length - included.length,
      costUsdc: totalCost.toString(),
      value: { raw: totalValue.toString(), decimals },
      unrealized: totals.unrealized,
      unrealizedBps: totals.bps,
    },
    realized: null,
    sources: [
      "Ovelo purchase receipts (confirmed)",
      "Exact fills from the confirmed transactions (Solana mainnet RPC)",
      "Balances from Solana mainnet RPC",
    ],
  });
}
