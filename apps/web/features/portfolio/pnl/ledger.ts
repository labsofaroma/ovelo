/**
 * Average-cost ledger for one mint (M11 Step 2). Pure and integer-only (AGENTS.md rule 5): every
 * quantity is a token's raw units, every cost or proceeds amount is the funding token's raw
 * units, all `bigint`.
 *
 * Method: AVERAGE COST.
 * - A buy adds its quantity and its exact cost.
 * - A sell or a transfer out of `q` removes cost at the average: `removed = floor(cost × q / qty)`.
 *   Rounding rule: the removed cost is rounded DOWN (toward zero), so the remaining cost keeps any
 *   remainder; when the last unit leaves (`q = qty`) the removed cost is exactly the remaining cost,
 *   so nothing is ever left behind on an empty position and the cost basis is never negative.
 * - A sell's realized P&L is `proceeds − removed`. A transfer out has no proceeds: its removed
 *   cost leaves the position without a realized figure (Aroma cannot know what it was worth).
 * - Taking out more than is held is refused (the caller reconciles against the chain first).
 */
export type LedgerEvent =
  | { kind: "buy"; quantity: bigint; cost: bigint }
  | { kind: "sell"; quantity: bigint; proceeds: bigint }
  | { kind: "transfer_out"; quantity: bigint };

export type Position = {
  quantity: bigint;
  /** Remaining cost basis of `quantity`. */
  cost: bigint;
  /** Sum of `proceeds − removed cost` over sells. */
  realized: bigint;
  /** Cost removed by transfers out (no proceeds known). */
  transferredCost: bigint;
};

export const EMPTY: Position = {
  quantity: 0n,
  cost: 0n,
  realized: 0n,
  transferredCost: 0n,
};

export function apply(position: Position, event: LedgerEvent): Position {
  if (event.quantity <= 0n) throw new RangeError("quantity must be positive");
  if (event.kind === "buy") {
    if (event.cost < 0n) throw new RangeError("cost must not be negative");
    return {
      ...position,
      quantity: position.quantity + event.quantity,
      cost: position.cost + event.cost,
    };
  }
  if (event.quantity > position.quantity)
    throw new RangeError("cannot remove more than is held");
  const removed =
    event.quantity === position.quantity
      ? position.cost
      : (position.cost * event.quantity) / position.quantity;
  const next = {
    ...position,
    quantity: position.quantity - event.quantity,
    cost: position.cost - removed,
  };
  if (event.kind === "sell") {
    if (event.proceeds < 0n)
      throw new RangeError("proceeds must not be negative");
    return { ...next, realized: position.realized + event.proceeds - removed };
  }
  return { ...next, transferredCost: position.transferredCost + removed };
}

export const replay = (events: readonly LedgerEvent[]): Position =>
  events.reduce(apply, EMPTY);

/** Scale `value` by `num / den`, rounded down (for a share of a position). */
export const share = (value: bigint, num: bigint, den: bigint): bigint =>
  den === 0n ? 0n : (value * num) / den;
