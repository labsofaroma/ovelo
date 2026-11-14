/**
 * The `receipts.legs` record of an installment transaction, from its `InstallmentExecuted` event
 * (the chain's own account of what ran). Shared by the keeper (writes) and the web app (backfill
 * and timeline), so both store exactly the same shape. Amounts are decimal strings of raw units.
 */
import type { InstallmentExecutedEvent } from "./generated";
import type { TimelineExecution } from "./timeline";

export type InstallmentLegRecord = {
  leg: number;
  mint: string;
  amountIn: string;
  fee: string;
  amountOut: string;
  minOut: string;
  oraclePrice: string;
  oracleExpo: number;
  oraclePublishTime: string;
  multiplierFp: string;
  /** Repeated on each leg: this transaction completed the period. */
  periodComplete: boolean;
  newlySkipped: number;
};

export function installmentRecord(event: InstallmentExecutedEvent): {
  /** Funding this transaction spent (legs' amount_in + fee), raw units. */
  amountIn: bigint;
  legs: InstallmentLegRecord[];
} {
  let amountIn = 0n;
  const legs = event.legs.map((leg) => {
    amountIn += leg.amountIn + leg.fee;
    return {
      leg: leg.leg,
      mint: leg.mint,
      amountIn: leg.amountIn.toString(),
      fee: leg.fee.toString(),
      amountOut: leg.amountOut.toString(),
      minOut: leg.minOut.toString(),
      oraclePrice: leg.oraclePrice.toString(),
      oracleExpo: leg.oracleExpo,
      oraclePublishTime: leg.oraclePublishTime.toString(),
      multiplierFp: leg.multiplierFp.toString(),
      periodComplete: event.periodComplete,
      newlySkipped: event.newlySkipped,
    };
  });
  return { amountIn, legs };
}

const isRecord = (value: unknown): value is InstallmentLegRecord =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as InstallmentLegRecord).mint === "string" &&
  typeof (value as InstallmentLegRecord).amountOut === "string" &&
  typeof (value as InstallmentLegRecord).periodComplete === "boolean";

/** Turn stored receipts back into timeline executions (malformed rows are ignored). */
export function executionsFromReceipts(
  rows: readonly {
    signature: string;
    period: number | null;
    blockTime: bigint | null;
    legs: readonly unknown[];
  }[],
): Map<number, TimelineExecution[]> {
  const out = new Map<number, TimelineExecution[]>();
  for (const row of rows) {
    if (row.period === null) continue;
    const legs = row.legs.filter(isRecord);
    if (!legs.length) continue;
    const list = out.get(row.period) ?? [];
    list.push({
      signature: row.signature,
      blockTime: row.blockTime,
      periodComplete: legs.some((l) => l.periodComplete),
      legs: legs.map((l) => ({
        leg: l.leg,
        mint: l.mint as TimelineExecution["legs"][number]["mint"],
        amountIn: BigInt(l.amountIn),
        fee: BigInt(l.fee),
        amountOut: BigInt(l.amountOut),
        minOut: BigInt(l.minOut),
        oraclePrice: BigInt(l.oraclePrice),
        oracleExpo: l.oracleExpo,
        oraclePublishTime: BigInt(l.oraclePublishTime),
        multiplierFp: BigInt(l.multiplierFp),
      })),
    });
    out.set(row.period, list);
  }
  return out;
}
