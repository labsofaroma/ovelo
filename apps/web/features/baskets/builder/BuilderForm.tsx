"use client";

import { Button, Field, Input } from "@ovelo/ui";
import { PublishPanel } from "../../creators/components/PublishPanel";
import { useEffect, useMemo, useState } from "react";
import {
  basketPublishSchema,
  DESCRIPTION_MAX,
  MAX_LEGS,
  MIN_LEGS,
  NAME_MAX,
} from "../../creators/schema";
import type { MarketRow } from "../../markets/schema";
import { AssetPicker } from "./AssetPicker";
import { type PickerAsset, toPickerAsset } from "./assets";
import { BuilderPreview } from "./BuilderPreview";
import { clearDraft, EMPTY_DRAFT, loadDraft, saveDraft } from "./draft";
import { equalWeights } from "./weights";
import { type WeightRow, WeightEditor } from "./WeightEditor";

export interface BuilderFormProps {
  /** Selectable rows of the market snapshot (listed, verified, not halted). */
  market: readonly MarketRow[];
  asOf: string;
  /** A published basket of the connected creator, to publish its next version (`?from=`). */
  initial?: {
    basketId: string;
    name: string;
    ticker: string;
    description: string;
    rows: WeightRow[];
    version: number;
  };
}

type Storage =
  "loading" | "saved" | "restored" | "unavailable" | "discarded" | "editing";

const STORAGE_TEXT: Record<Storage, string> = {
  loading: "Checking this browser for a saved draft…",
  saved: "Draft saved in this browser only.",
  restored: "Restored your draft from this browser.",
  unavailable:
    "This browser is not letting Ovelo save, so the draft will be lost when you leave.",
  discarded: "A saved draft could not be read and was ignored.",
  editing:
    "Editing a published basket. Your browser draft is left untouched; publishing creates the next version.",
};

/** Human-readable reasons the draft cannot be published yet, from the shared zod schema. */
export function publishProblems(draft: {
  name: string;
  ticker: string;
  description: string;
  rows: readonly WeightRow[];
}): string[] {
  const parsed = basketPublishSchema.safeParse({
    name: draft.name,
    ticker: draft.ticker,
    description: draft.description,
    allocations: draft.rows.map(({ mint, weightBps }) => ({ mint, weightBps })),
  });
  if (parsed.success) return [];
  const problems = new Set<string>();
  for (const issue of parsed.error.issues) {
    const [field, , leaf] = issue.path;
    if (field === "name")
      problems.add(`Give the basket a name of up to ${NAME_MAX} characters.`);
    else if (field === "ticker")
      problems.add("The ticker needs 2 to 15 letters or digits.");
    else if (field === "description")
      problems.add(`Keep the description under ${DESCRIPTION_MAX} characters.`);
    else if (leaf === "weightBps")
      problems.add("Every asset needs a weight above 0%.");
    else if (draft.rows.length < MIN_LEGS)
      problems.add(`Choose at least ${MIN_LEGS} assets.`);
    else problems.add("The weights must add up to exactly 100%.");
  }
  return [...problems];
}

export function BuilderForm({ market, asOf, initial }: BuilderFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [ticker, setTicker] = useState(initial?.ticker ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [rows, setRows] = useState<WeightRow[]>(initial?.rows ?? []);
  const [storage, setStorage] = useState<Storage>(
    initial ? "editing" : "loading",
  );

  // Restore once on mount; storage is browser-only and may be blocked.
  useEffect(() => {
    if (initial) return;
    const loaded = loadDraft();
    if (loaded.state === "loaded") {
      setName(loaded.draft.name);
      setTicker(loaded.draft.ticker);
      setDescription(loaded.draft.description);
      setRows(loaded.draft.allocations);
      setStorage("restored");
    } else if (loaded.state === "unavailable") setStorage("unavailable");
    else if (loaded.state === "invalid") setStorage("discarded");
    else setStorage("saved");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  useEffect(() => {
    if (storage === "loading" || storage === "editing") return;
    const ok = saveDraft({
      ...EMPTY_DRAFT,
      name,
      ticker,
      description,
      allocations: rows,
    });
    if (!ok && storage !== "unavailable") setStorage("unavailable");
  }, [name, ticker, description, rows, storage]);

  const assets = useMemo(() => {
    const known = market.map(toPickerAsset);
    const listed = new Set(known.map((asset) => asset.mint));
    // Restored draft assets that are no longer listed or priced stay visible, but unavailable.
    const gone: PickerAsset[] = rows
      .filter((row) => !listed.has(row.mint))
      .map((row) => ({
        mint: row.mint,
        symbol: row.symbol,
        name: "Not in the current snapshot",
        issuer: "Unknown issuer",
        price: null,
        priceSource: null,
        priceObservedAt: null,
        selectable: false,
        reason: "No longer listed or priced",
      }));
    return [...gone, ...known];
  }, [market, rows]);

  const selected = useMemo(() => new Set(rows.map((row) => row.mint)), [rows]);
  const problems = publishProblems({ name, ticker, description, rows });

  // Adding or removing an asset re-spreads the weights evenly; the editor fine-tunes them after.
  function spread(next: WeightRow[]) {
    const weights = equalWeights(next.length);
    setRows(next.map((row, i) => ({ ...row, weightBps: weights[i]! })));
  }
  const remove = (mint: string) =>
    spread(rows.filter((row) => row.mint !== mint));
  function toggle(asset: PickerAsset) {
    if (selected.has(asset.mint)) remove(asset.mint);
    else if (rows.length < MAX_LEGS)
      spread([
        ...rows,
        { mint: asset.mint, symbol: asset.symbol, weightBps: 0 },
      ]);
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="flex min-w-0 flex-col gap-8">
        <section
          aria-labelledby="builder-details"
          className="flex flex-col gap-4"
        >
          <h2 id="builder-details" className="text-title font-semibold">
            Name it
          </h2>
          <Field label="Basket name" required>
            <Input
              value={name}
              maxLength={NAME_MAX}
              required
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field
            label="Ticker"
            hint="2 to 15 letters or digits, for example CHIPS."
            required
          >
            <Input
              value={ticker}
              maxLength={15}
              required
              autoCapitalize="characters"
              onChange={(event) => setTicker(event.target.value.toUpperCase())}
            />
          </Field>
          <Field
            label="Description"
            hint={`Optional, up to ${DESCRIPTION_MAX} characters.`}
          >
            <Input
              value={description}
              maxLength={DESCRIPTION_MAX}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
        </section>
        <AssetPicker assets={assets} selected={selected} onToggle={toggle} />
      </div>
      <div className="flex min-w-0 flex-col gap-8">
        <WeightEditor rows={rows} onChange={setRows} onRemove={remove} />
        <BuilderPreview
          name={name}
          ticker={ticker}
          description={description}
          rows={rows}
          market={market}
          asOf={asOf}
        />
        <section
          aria-labelledby="builder-publish"
          className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4"
        >
          <h2 id="builder-publish" className="text-title font-semibold">
            Publish
          </h2>
          {problems.length ? (
            <ul className="list-disc space-y-1 pl-5 text-small">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : (
            <p className="text-small">The allocation is complete.</p>
          )}
          <PublishPanel
            problems={problems}
            basket={{
              name,
              ticker,
              description,
              allocations: rows.map(({ mint, weightBps }) => ({
                mint,
                weightBps,
              })),
            }}
            {...(initial ? { basketId: initial.basketId } : {})}
            onPublished={() => {
              if (!initial) clearDraft();
            }}
          />
          {initial ? null : (
            <div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  clearDraft();
                  setName("");
                  setTicker("");
                  setDescription("");
                  setRows([]);
                }}
              >
                Clear draft
              </Button>
            </div>
          )}
          <p role="status" className="text-caption text-muted">
            {STORAGE_TEXT[storage]}
          </p>
        </section>
      </div>
    </div>
  );
}
