"use client";

import { Badge } from "@aroma/ui";
import { formatUnits } from "@aroma/ui/format";
import Link from "next/link";
import { routes } from "../../shared/routes";
import { ConnectButton } from "../../wallet/ConnectButton";
import {
  WALLET_INSTALL_GUIDES,
  walletBrowseLinks,
} from "../../wallet/onboarding";
import { onboardingCopy as copy } from "../copy";
import type { useOnboarding } from "../useOnboarding";

export type Suggestion = { id: string; name: string; tokens: number };

const sol = (lamports: bigint) =>
  formatUnits(lamports, 9, { fractionDigits: 4 }).text;
const usdc = (raw: bigint) => formatUnits(raw, 6, { fractionDigits: 2 }).text;
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

const card =
  "flex flex-col gap-3 rounded-panel border border-line bg-surface p-4";

/** The three onboarding steps. Pure props, so it is tested without a wallet or network. */
export function OnboardingSteps({
  address,
  funds,
  suggestion,
  capText,
  paused,
  pageUrl,
}: {
  address: string | null;
  funds: Pick<
    ReturnType<typeof useOnboarding>,
    "step" | "loading" | "error" | "sol" | "usdc" | "needed"
  >;
  suggestion: Suggestion | null;
  capText: string;
  paused: boolean;
  pageUrl: string;
}) {
  const done = (step: "wallet" | "funds") =>
    step === "wallet" ? Boolean(address) : funds.step === "first_buy";
  return (
    <ol className="flex flex-col gap-4">
      <li className={card} aria-labelledby="step-wallet">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="step-wallet" className="text-section font-semibold">
            {copy.step1}
          </h2>
          {done("wallet") ? <Badge tone="up">Done</Badge> : null}
        </div>
        {address ? (
          <p className="text-small">{copy.connected(short(address))}</p>
        ) : (
          <>
            <p className="text-small">{copy.noWallet}</p>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-small">
              {WALLET_INSTALL_GUIDES.map((g) => (
                <li key={g.name}>
                  <a
                    href={g.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    Install {g.name}
                  </a>
                </li>
              ))}
            </ul>
            <div className="text-small">
              <p>{copy.phone}</p>
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {walletBrowseLinks(pageUrl).map((g) => (
                  <li key={g.name}>
                    <a href={g.href} className="underline">
                      Open in {g.name}
                    </a>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-muted">{copy.phoneHint}</p>
            </div>
          </>
        )}
        <div>
          <ConnectButton />
        </div>
      </li>

      <li className={card} aria-labelledby="step-funds">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="step-funds" className="text-section font-semibold">
            {copy.step2}
          </h2>
          {done("funds") ? <Badge tone="up">Done</Badge> : null}
        </div>
        {!address ? null : funds.loading ? (
          <p role="status" className="text-small text-muted">
            {copy.balancesLoading}
          </p>
        ) : funds.error || funds.sol === null || funds.usdc === null ? (
          <p className="text-small text-muted">{copy.balancesUnavailable}</p>
        ) : (
          <>
            <p className="text-small">
              {copy.balances(sol(funds.sol), usdc(funds.usdc))}
            </p>
            <p className="text-small">
              {copy.solNeeded(suggestion?.tokens ?? 1, sol(funds.needed))}
            </p>
            <p className="text-small">
              {funds.sol >= funds.needed
                ? copy.solOk
                : copy.solShort(sol(funds.needed - funds.sol))}
            </p>
            {funds.usdc === 0n ? (
              <p className="text-small">{copy.usdcNone}</p>
            ) : null}
          </>
        )}
        <p className="text-small text-muted">{copy.fund}</p>
        <p className="text-small text-muted">{copy.usdcLimit(capText)}</p>
      </li>

      <li className={card} aria-labelledby="step-buy">
        <h2 id="step-buy" className="text-section font-semibold">
          {copy.step3}
        </h2>
        {paused ? <p className="text-small">{copy.paused}</p> : null}
        {suggestion ? (
          <>
            <p className="text-body font-semibold">
              {copy.suggestion(suggestion.name, suggestion.tokens)}
            </p>
            <p className="text-small text-muted">{copy.suggestionWhy}</p>
            <p className="text-small text-muted">{copy.gates}</p>
            <div className="flex flex-wrap items-center gap-4 text-small">
              <Link
                href={routes.basket(suggestion.id)}
                className="rounded-control bg-accent px-3 py-2 font-semibold text-accent-ink"
              >
                {copy.open}
              </Link>
              <Link href={routes.markets} className="underline">
                {copy.orStock}
              </Link>
            </div>
          </>
        ) : (
          <p className="text-small">
            {copy.suggestionNone}{" "}
            <Link href={routes.markets} className="underline">
              {copy.orStock}
            </Link>
          </p>
        )}
      </li>
    </ol>
  );
}
