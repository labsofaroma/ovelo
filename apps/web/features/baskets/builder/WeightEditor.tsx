"use client";

import { Button, IconButton, Input, Section, cn } from "@ovelo/ui";
import { Scale, Trash2 } from "lucide-react";
import { type KeyboardEvent, useId, useState } from "react";
import { formatBps } from "../../shared/fixed";
import { BPS_TOTAL } from "../../creators/schema";
import {
  bpsToPercentText,
  clampBps,
  equalWeights,
  normalizeWeights,
  parsePercent,
} from "./weights";

export type WeightRow = { mint: string; symbol: string; weightBps: number };

export interface WeightEditorProps {
  rows: readonly WeightRow[];
  onChange: (rows: WeightRow[]) => void;
  onRemove: (mint: string) => void;
}

/**
 * Integer basis-point weights with a live total. Each weight is typed as a percentage with up to
 * two decimals (0.01% = 1 bp). Keyboard: ArrowUp/ArrowDown change it by 0.01%, with Shift by 1%;
 * Enter commits. "Equal weights" and "Normalize to 100%" use deterministic integer rounding.
 */
export function WeightEditor({ rows, onChange, onRemove }: WeightEditorProps) {
  const statusId = useId();
  const [editing, setEditing] = useState<{ mint: string; text: string } | null>(
    null,
  );
  const total = rows.reduce((sum, row) => sum + row.weightBps, 0);
  const difference = BPS_TOTAL - total;
  const zeros = rows.filter((row) => row.weightBps === 0).length;

  const setWeight = (mint: string, weightBps: number) =>
    onChange(
      rows.map((row) =>
        row.mint === mint ? { ...row, weightBps: clampBps(weightBps) } : row,
      ),
    );

  function commit(mint: string) {
    if (!editing || editing.mint !== mint) return;
    const parsed = parsePercent(editing.text);
    if (parsed !== null) {
      setWeight(mint, parsed);
      setEditing(null);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>, row: WeightRow) {
    if (event.key === "Enter") {
      event.preventDefault();
      commit(row.mint);
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const step =
      (event.shiftKey ? 100 : 1) * (event.key === "ArrowUp" ? 1 : -1);
    const current =
      editing?.mint === row.mint
        ? (parsePercent(editing.text) ?? row.weightBps)
        : row.weightBps;
    setEditing(null);
    setWeight(row.mint, current + step);
  }

  const status =
    rows.length === 0
      ? "Add assets to set their weights."
      : difference === 0
        ? zeros
          ? `Total is 100.00%, but ${zeros === 1 ? "one asset has" : `${zeros} assets have`} no weight.`
          : "Total is 100.00%. Ready to preview."
        : difference > 0
          ? `Total is ${formatBps(total)}. ${formatBps(difference)} left to assign.`
          : `Total is ${formatBps(total)}. ${formatBps(-difference)} over 100%.`;

  const ready = difference === 0 && zeros === 0 && rows.length > 0;

  return (
    <Section
      eyebrow="Step 3"
      title="Set the weights"
      description="Weights are whole basis points (0.01%) and must add up to exactly 100%."
      actions={
        <>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={rows.length === 0}
            onClick={() => {
              setEditing(null);
              const weights = equalWeights(rows.length);
              onChange(
                rows.map((row, i) => ({ ...row, weightBps: weights[i]! })),
              );
            }}
          >
            Equal weights
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={rows.length === 0 || (difference === 0 && zeros === 0)}
            onClick={() => {
              setEditing(null);
              const weights = normalizeWeights(
                rows.map((row) => row.weightBps),
              );
              onChange(
                rows.map((row, i) => ({ ...row, weightBps: weights[i]! })),
              );
            }}
          >
            <Scale aria-hidden="true" className="size-4" />
            Normalize to 100%
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {rows.length ? (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => {
              const inputId = `${statusId}-${row.mint}`;
              const text =
                editing?.mint === row.mint
                  ? editing.text
                  : bpsToPercentText(row.weightBps);
              const invalid =
                editing?.mint === row.mint &&
                parsePercent(editing.text) === null;
              return (
                <li
                  key={row.mint}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-2 rounded-tile border border-line bg-raised p-3 md:grid-cols-[minmax(6rem,1fr)_minmax(6rem,2fr)_auto_auto_auto]"
                >
                  <label
                    htmlFor={inputId}
                    className="min-w-0 truncate text-small font-semibold text-ink"
                  >
                    {row.symbol}
                    <span className="sr-only"> weight, percent</span>
                  </label>
                  <span
                    aria-hidden="true"
                    className="relative h-1.5 overflow-hidden rounded-full bg-raised-2 max-md:hidden"
                  >
                    <span
                      className="absolute inset-y-0 left-0 rounded-full bg-accent"
                      style={{
                        width: `${Math.min(100, row.weightBps / 100)}%`,
                      }}
                    />
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <div className="relative w-24 sm:w-28">
                      <Input
                        id={inputId}
                        size="sm"
                        inputMode="decimal"
                        autoComplete="off"
                        className="pr-8 text-right tabular-nums"
                        value={text}
                        invalid={invalid}
                        aria-describedby={statusId}
                        onChange={(event) =>
                          setEditing({
                            mint: row.mint,
                            text: event.target.value,
                          })
                        }
                        onBlur={() => commit(row.mint)}
                        onKeyDown={(event) => onKeyDown(event, row)}
                      />
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-small text-muted"
                      >
                        %
                      </span>
                    </div>
                  </div>
                  <span className="inline-flex min-h-6.5 items-center rounded-full border border-line bg-raised-2 px-2.5 text-caption font-medium tabular-nums text-ink max-sm:hidden">
                    {row.weightBps.toLocaleString("en-US")} bps
                  </span>
                  <IconButton
                    aria-label={`Remove ${row.symbol}`}
                    size="sm"
                    icon={<Trash2 aria-hidden="true" className="size-4" />}
                    onClick={() => onRemove(row.mint)}
                  />
                </li>
              );
            })}
          </ul>
        ) : null}
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-3 rounded-tile border p-4",
            ready
              ? "border-line bg-raised-2"
              : "border-transparent bg-warning-soft",
          )}
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-caption font-medium text-muted">Total</span>
            <p
              id={statusId}
              role="status"
              aria-live="polite"
              data-state={ready ? "ok" : "pending"}
              className={
                difference === 0 && zeros === 0
                  ? "text-small text-ink"
                  : "text-small font-semibold text-down"
              }
            >
              {status}
            </p>
          </div>
          <strong
            aria-hidden="true"
            className={cn(
              "font-display text-title font-medium tabular-nums",
              ready ? "text-up" : "text-ink",
            )}
          >
            {formatBps(total)}
          </strong>
        </div>
        <p className="text-caption leading-body text-muted">
          Use the arrow keys to adjust a weight by 0.01%, or Shift with the
          arrow keys for 1%. Enter commits a typed weight.
        </p>
      </div>
    </Section>
  );
}
