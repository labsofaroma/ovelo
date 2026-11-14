"use client";

import { Button, Field, Input } from "@aroma/ui";
import { useState } from "react";
import { useSigner } from "../../wallet/context";
import { investApi } from "../api";
import { explorerUrl } from "../amounts";
import { useSignedPlanFlow } from "../queries";
import {
  buildCreateRequest,
  periodChoices,
  type WizardField,
  type WizardState,
} from "../wizard";
import { ReviewPanel } from "./ReviewPanel";
import type { InvestPageData } from "./types";
import { SelectionStep } from "./SelectionStep";

const selectClass =
  "min-h-(--aroma-control-height) rounded-control border border-line bg-surface px-3 text-small focus-ring";

/** Choose → amount and schedule → review (server summary) → sign → submitted. */
export function PlanWizard({ data }: { data: InvestPageData }) {
  const signer = useSigner();
  const choices = periodChoices(data.cluster);
  const [state, setState] = useState<WizardState>({
    mode: data.baskets.some((b) => b.available) ? "basket" : "assets",
    basketId: data.baskets.find((b) => b.available)?.id ?? null,
    weights: {},
    amount: "10",
    periodSeconds: choices[0]!.seconds,
    periods: "4",
  });
  const [errors, setErrors] = useState<Partial<Record<WizardField, string>>>(
    {},
  );
  const flow = useSignedPlanFlow({ cluster: data.cluster, signer });

  if (!signer)
    return (
      <p className="text-small text-muted">
        Connect a devnet wallet to create a plan.
      </p>
    );

  const { step } = flow.state;
  if (flow.state.step === "done") {
    const result = flow.state.result;
    return (
      <section
        data-testid="wizard-done"
        role="status"
        className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-4 text-small"
      >
        <p className="font-semibold">Plan created on {data.cluster}.</p>
        {result.result.map((line) => (
          <p key={line}>{line}</p>
        ))}
        <a
          className="text-accent underline focus-ring"
          href={explorerUrl(
            result.signature,
            data.cluster,
            data.explorerRpcUrl,
          )}
          target="_blank"
          rel="noreferrer"
        >
          Transaction {result.signature.slice(0, 8)}…
        </a>
        <div>
          <Button variant="secondary" onClick={flow.reset}>
            Create another plan
          </Button>
        </div>
      </section>
    );
  }
  if (
    flow.state.step === "review" ||
    flow.state.step === "signing" ||
    flow.state.step === "submitting"
  ) {
    const prepared = flow.state.prepared;
    return (
      <ReviewPanel
        summary={prepared.summary}
        state={flow.state}
        confirmLabel="Sign and create plan"
        testId="sign-and-create"
        onConfirm={() => flow.confirm(prepared)}
        onBack={flow.reset}
      />
    );
  }

  const review = () => {
    const built = buildCreateRequest(signer.address, state, {
      decimals: data.fundingDecimals,
      maxInstallmentRaw: BigInt(data.maxInstallmentRaw),
      baskets: data.baskets,
    });
    setErrors(built.ok ? {} : built.errors);
    if (!built.ok) return;
    flow.start(() => investApi.prepareCreate(built.request));
  };

  return (
    <form
      data-testid="wizard-form"
      className="flex flex-col gap-4 rounded-panel border border-line bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        review();
      }}
    >
      <SelectionStep
        data={data}
        state={state}
        onChange={setState}
        errors={errors}
      />
      <div className="grid gap-4 md:grid-cols-3">
        <Field
          label={`Amount per installment (${data.fundingSymbol})`}
          error={errors.amount}
        >
          <Input
            data-testid="wizard-amount"
            inputMode="decimal"
            value={state.amount}
            onChange={(e) => setState({ ...state, amount: e.target.value })}
          />
        </Field>
        <label className="flex flex-col gap-1 text-small font-semibold">
          How often
          <select
            data-testid="wizard-period"
            className={selectClass}
            value={state.periodSeconds}
            onChange={(e) =>
              setState({ ...state, periodSeconds: Number(e.target.value) })
            }
          >
            {choices.map((choice) => (
              <option key={choice.seconds} value={choice.seconds}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        <Field label="Number of installments" error={errors.periods}>
          <Input
            data-testid="wizard-periods"
            inputMode="numeric"
            value={state.periods}
            onChange={(e) => setState({ ...state, periods: e.target.value })}
          />
        </Field>
      </div>
      {flow.state.step === "error" ? (
        <p
          role="alert"
          data-testid="wizard-error"
          className="text-small text-down"
        >
          {flow.state.message}
        </p>
      ) : null}
      <p role="status" aria-live="polite" className="text-small text-muted">
        {step === "preparing" ? "Preparing and simulating on devnet…" : ""}
      </p>
      <div>
        <Button
          type="submit"
          data-testid="wizard-review"
          loading={step === "preparing"}
        >
          Review plan
        </Button>
      </div>
    </form>
  );
}
