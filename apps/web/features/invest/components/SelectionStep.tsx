"use client";

import { Input } from "@ovelo/ui";
import { formatRaw } from "../server/format";
import type { WizardField, WizardState } from "../wizard";
import type { InvestPageData } from "./types";

const pct = (bps: number) => `${formatRaw(BigInt(bps), 2)}%`;

/** Step 1: a curated or creator basket, or single/custom assets with weights. */
export function SelectionStep({
  data,
  state,
  onChange,
  errors,
}: {
  data: InvestPageData;
  state: WizardState;
  onChange: (next: WizardState) => void;
  errors: Partial<Record<WizardField, string>>;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-4">
      <legend className="sr-only">What to buy</legend>
      <div
        role="radiogroup"
        aria-label="Plan type"
        className="inline-flex w-fit flex-wrap gap-1 rounded-full border border-line bg-raised p-1 text-small"
      >
        {(["basket", "assets"] as const).map((mode) => (
          <label
            key={mode}
            className="flex min-h-9 cursor-pointer items-center gap-2 rounded-full px-4 text-muted transition-colors motion-base hover:text-ink has-[:checked]:bg-raised-2 has-[:checked]:text-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-(--ovelo-focus)"
          >
            <input
              type="radio"
              name="plan-mode"
              data-testid={`wizard-mode-${mode}`}
              checked={state.mode === mode}
              onChange={() => onChange({ ...state, mode })}
              className="sr-only"
            />
            {mode === "basket" ? "A basket" : "Single or custom assets"}
          </label>
        ))}
      </div>
      {state.mode === "basket" ? (
        <ul
          className="grid grid-cols-1 gap-3 md:grid-cols-2"
          data-testid="wizard-baskets"
        >
          {data.baskets.length === 0 ? (
            <li className="text-small text-muted md:col-span-2">
              No baskets are available right now.
            </li>
          ) : null}
          {data.baskets.map((basket) => (
            <li key={basket.id}>
              <label
                className={`flex h-full items-start gap-3 rounded-tile border border-line bg-raised p-4 text-small transition-colors motion-base has-[:checked]:border-border-strong has-[:checked]:bg-raised-2 ${basket.available ? "cursor-pointer hover:border-border-strong" : "opacity-60"}`}
              >
                <input
                  type="radio"
                  name="plan-basket"
                  data-testid={`wizard-basket-${basket.id}`}
                  disabled={!basket.available}
                  checked={state.basketId === basket.id}
                  onChange={() => onChange({ ...state, basketId: basket.id })}
                  className="mt-0.5 accent-(--ovelo-accent)"
                />
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="font-semibold text-ink">
                    {basket.name}{" "}
                    <span className="text-caption text-muted">
                      ({basket.kind === "curated" ? "curated" : "creator"})
                    </span>
                  </span>
                  {basket.available ? (
                    <span className="text-caption text-muted">
                      {basket.outputs
                        .map((o) => `${o.symbol} ${pct(o.weightBps)}`)
                        .join(" · ")}
                    </span>
                  ) : (
                    <span className="text-caption text-muted">
                      Not on devnet: {basket.missing.join(", ")}
                    </span>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-3" data-testid="wizard-assets">
          <p className="text-caption text-muted">
            Give each asset you want a percentage; the weights must add up to
            100%.
          </p>
          {data.assets.map((asset) => (
            <label
              key={asset.mint}
              className="grid grid-cols-[1fr_8rem] items-center gap-3 rounded-tile border border-line bg-raised px-4 py-2.5 text-small"
            >
              <span>
                <span className="font-semibold text-ink">{asset.symbol}</span>{" "}
                <span className="text-muted">{asset.name}</span>
                {asset.enabled ? null : (
                  <span className="text-down"> (paused)</span>
                )}
              </span>
              <Input
                aria-label={`${asset.symbol} weight in percent`}
                data-testid={`wizard-weight-${asset.symbol}`}
                inputMode="decimal"
                placeholder="0"
                disabled={!asset.enabled}
                value={state.weights[asset.mint] ?? ""}
                onChange={(e) =>
                  onChange({
                    ...state,
                    weights: { ...state.weights, [asset.mint]: e.target.value },
                  })
                }
              />
            </label>
          ))}
        </div>
      )}
      {errors.selection ? (
        <p role="alert" className="text-small text-down">
          {errors.selection}
        </p>
      ) : null}
      {errors.weights ? (
        <p role="alert" className="text-small text-down">
          {errors.weights}
        </p>
      ) : null}
    </fieldset>
  );
}
