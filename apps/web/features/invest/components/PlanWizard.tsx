"use client";

import { Button, Field, Input } from "@ovelo/ui";
import { useState, type ReactNode } from "react";
import { CheckCircle2, ExternalLink } from "lucide-react";
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
import { WizardStep } from "./WizardStep";

const selectClass =
  "min-h-(--ovelo-control-height) w-full rounded-control border border-border-strong bg-surface px-3 text-small font-normal text-ink transition-colors motion-base hover:border-ink focus-ring";

/** Step 4 on its own, for the signed review and the result (the form renders steps 2 to 4). */
function ReviewStep({ children }: { children: ReactNode }) {
  return (
    <ol className="flex flex-col">
      <WizardStep n={4} title="Review and sign" last>
        {children}
      </WizardStep>
    </ol>
  );
}

/** Choose → amount and schedule → review (server summary) → sign → submitted. */
export function PlanWizard({ data }: { data: InvestPageData }) {
  const signer = useSigner();
  const choices = periodChoices(data.cluster, data.testPeriods === true);
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
      <ReviewStep>
        <p className="text-small text-muted">
          Connect a devnet wallet to create a plan.
        </p>
      </ReviewStep>
    );

  const { step } = flow.state;
  if (flow.state.step === "done") {
    const result = flow.state.result;
    return (
      <ReviewStep>
        <section
          data-testid="wizard-done"
          role="status"
          className="flex flex-col gap-2 rounded-tile border border-line bg-raised p-4 text-small md:p-5"
        >
          <p className="flex items-center gap-2 font-semibold text-ink">
            <CheckCircle2 className="size-4 text-up" aria-hidden />
            Plan created on {data.cluster}.
          </p>
          {result.result.map((line) => (
            <p key={line} className="text-muted">
              {line}
            </p>
          ))}
          <a
            className="inline-flex w-fit items-center gap-1 rounded-badge text-ink underline underline-offset-4 focus-ring"
            href={explorerUrl(
              result.signature,
              data.cluster,
              data.explorerRpcUrl,
            )}
            target="_blank"
            rel="noreferrer"
          >
            Transaction {result.signature.slice(0, 8)}…
            <ExternalLink className="size-3" aria-hidden />
          </a>
          <div className="pt-2">
            <Button variant="secondary" onClick={flow.reset}>
              Create another plan
            </Button>
          </div>
        </section>
      </ReviewStep>
    );
  }
  if (
    flow.state.step === "review" ||
    flow.state.step === "signing" ||
    flow.state.step === "submitting"
  ) {
    const prepared = flow.state.prepared;
    return (
      <ReviewStep>
        <ReviewPanel
          summary={prepared.summary}
          state={flow.state}
          confirmLabel="Sign and create plan"
          testId="sign-and-create"
          onConfirm={() => flow.confirm(prepared)}
          onBack={flow.reset}
        />
      </ReviewStep>
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
      onSubmit={(event) => {
        event.preventDefault();
        review();
      }}
    >
      <ol className="flex flex-col">
        <WizardStep n={2} title="What to buy">
          <SelectionStep
            data={data}
            state={state}
            onChange={setState}
            errors={errors}
          />
        </WizardStep>
        <WizardStep n={3} title="Amount and schedule">
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
            <label className="flex flex-col gap-1.5 text-small font-semibold">
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
                onChange={(e) =>
                  setState({ ...state, periods: e.target.value })
                }
              />
            </Field>
          </div>
        </WizardStep>
        <WizardStep n={4} title="Review and sign" last>
          <div className="flex flex-col gap-3">
            {flow.state.step === "error" ? (
              <p
                role="alert"
                data-testid="wizard-error"
                className="rounded-tile bg-down-soft px-4 py-3 text-small text-ink"
              >
                {flow.state.message}
              </p>
            ) : null}
            <p
              role="status"
              aria-live="polite"
              className="text-small text-muted empty:hidden"
            >
              {step === "preparing"
                ? "Preparing and simulating on devnet…"
                : ""}
            </p>
            <div>
              <Button
                type="submit"
                variant="solid"
                size="lg"
                data-testid="wizard-review"
                loading={step === "preparing"}
              >
                Review plan
              </Button>
            </div>
          </div>
        </WizardStep>
      </ol>
    </form>
  );
}
