import { FUNDING_TOKENS } from "../../trade/schema";
import type { ReceiptInput } from "./build";
import type { Fills } from "./fills";
import type { PnlView } from "./schema";

/**
 * CSV export (M11 Step 2): this wallet's Ovelo orders and its P&L rows, raw and display amounts
 * side by side. Pure: built server-side from the same data as the page. Cells that a spreadsheet
 * would read as a formula are prefixed with `'` (CSV injection).
 */
export function csvCell(value: string | number | null): string {
  let text = value === null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Raw units → exact decimal text (bigint only). */
export function display(raw: string, decimals: number | null): string {
  if (decimals === null || !/^-?\d+$/.test(raw)) return "";
  const negative = raw.startsWith("-");
  const digits = (negative ? raw.slice(1) : raw).padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals ? `.${digits.slice(-decimals)}` : "";
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

const tokenDecimals = (mint: string) =>
  FUNDING_TOKENS.find((t) => t.mint === mint)?.decimals ?? null;

const HEADER = [
  "section",
  "time",
  "signature",
  "kind",
  "status",
  "basket",
  "mint",
  "input_mint",
  "input_raw",
  "input_display",
  "filled_raw",
  "quantity_raw",
  "quantity_display",
  "cost_usdc_raw",
  "cost_usdc_display",
  "value_usd",
  "unrealized_usd",
  "unrealized_bps",
  "basis_status",
  "price_source",
  "price_observed_at",
];

export function portfolioCsv(input: {
  receipts: readonly ReceiptInput[];
  fills: ReadonlyMap<string, Fills>;
  pnl: PnlView;
}): string {
  const lines = [HEADER.join(",")];
  const push = (cells: Record<string, string | number | null>) =>
    lines.push(HEADER.map((h) => csvCell(cells[h] ?? null)).join(","));
  // Mainnet orders only (devnet test-plan installments are not part of this portfolio).
  for (const r of input.receipts.filter(
    (x) => x.kind === "spot" || x.kind === "basket",
  ))
    for (const leg of r.legs)
      push({
        section: "order",
        time: r.createdAt.toISOString(),
        signature: r.signature,
        kind: r.kind,
        status: r.status,
        basket: leg.basket,
        mint: leg.mint,
        input_mint: r.mintIn,
        input_raw: leg.inputAmount,
        input_display: display(leg.inputAmount, tokenDecimals(r.mintIn)),
        filled_raw: input.fills.get(r.signature)?.[leg.mint] ?? null,
      });
  for (const row of input.pnl.rows)
    push({
      section: "pnl",
      mint: row.mint,
      quantity_raw: row.quantity,
      quantity_display: display(row.quantity, row.decimals),
      cost_usdc_raw: row.costUsdc,
      cost_usdc_display: row.costUsdc ? display(row.costUsdc, 6) : null,
      value_usd: row.value ? display(row.value.raw, row.value.decimals) : null,
      unrealized_usd: row.unrealized
        ? display(row.unrealized.raw, row.unrealized.decimals)
        : null,
      unrealized_bps: row.unrealizedBps,
      basis_status: row.status,
      price_source: row.priceSource,
      price_observed_at: row.priceObservedAt,
    });
  return `${lines.join("\r\n")}\r\n`;
}
