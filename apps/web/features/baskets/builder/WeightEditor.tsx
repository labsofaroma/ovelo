"use client";

import { Button, IconButton, Input } from "@aroma/ui";
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

  return (
    <section
      aria-labelledby={`${statusId}-title`}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`${statusId}-title`} className="text-title font-semibold">
          Set the weights
        </h2>
        <div className="flex flex-wrap gap-2">
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
        </div>
      </div>
      {rows.length ? (
        <ul className="flex flex-col divide-y divide-line rounded-panel border border-line">
          {rows.map((row) => {
            const inputId = `${statusId}-${row.mint}`;
            const text =
              editing?.mint === row.mint
                ? editing.text
                : bpsToPercentText(row.weightBps);
            const invalid =
              editing?.mint === row.mint && parsePercent(editing.text) === null;
            return (
              <li key={row.mint} className="flex items-center gap-3 px-3 py-2">
                <label
                  htmlFor={inputId}
                  className="min-w-0 flex-1 truncate text-body font-semibold"
                >
                  {row.symbol}
                  <span className="sr-only"> weight, percent</span>
                </label>
                <div className="flex items-center gap-1">
                  <Input
                    id={inputId}
                    size="sm"
                    inputMode="decimal"
                    autoComplete="off"
                    className="w-24 text-right tabular-nums"
                    value={text}
                    invalid={invalid}
                    aria-describedby={statusId}
                    onChange={(event) =>
                      setEditing({ mint: row.mint, text: event.target.value })
                    }
                    onBlur={() => commit(row.mint)}
                    onKeyDown={(event) => onKeyDown(event, row)}
                  />
                  <span aria-hidden="true" className="text-small text-muted">
                    %
                  </span>
                </div>
                <span className="w-20 text-right text-caption text-muted tabular-nums">
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
      <p
        id={statusId}
        role="status"
        aria-live="polite"
        data-state={
          difference === 0 && zeros === 0 && rows.length ? "ok" : "pending"
        }
        className={
          difference === 0 && zeros === 0
            ? "text-small text-ink"
            : "text-small font-semibold text-down"
        }
      >
        {status}
      </p>
      <p className="text-caption text-muted">
        Weights are whole basis points (0.01%). Use the arrow keys to adjust by
        0.01%, or Shift with the arrow keys for 1%. A basket must add up to
        exactly 100%.
      </p>
    </section>
  );
}
