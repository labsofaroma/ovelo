"use client";

import { ExternalLink } from "lucide-react";
import { Badge, Callout, Section, buttonClassName } from "@ovelo/ui";
import { formatUnits } from "@ovelo/ui/format";
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

const muted = "text-small leading-body text-muted";
const body = "text-small leading-body text-ink";
const done = <Badge tone="up">Done</Badge>;

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
  return (
    <ol className="flex flex-col gap-4 md:gap-5">
      <li>
        <Section
          eyebrow={copy.eyebrow(1)}
          title={copy.step1}
          actions={address ? done : null}
        >
          <div className="flex flex-col gap-4">
            {address ? (
              <p className={body}>{copy.connected(short(address))}</p>
            ) : (
              <>
                <p className={body}>{copy.noWallet}</p>
                <ul className="flex flex-wrap gap-2">
                  {WALLET_INSTALL_GUIDES.map((g) => (
                    <li key={g.name}>
                      <a
                        href={g.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={buttonClassName({
                          variant: "secondary",
                          size: "sm",
                        })}
                      >
                        Install {g.name}
                        <ExternalLink className="size-3.5" aria-hidden />
                      </a>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-col gap-2 rounded-tile border border-line bg-raised p-4">
                  <p className={body}>{copy.phone}</p>
                  <ul className="flex flex-wrap gap-2">
                    {walletBrowseLinks(pageUrl).map((g) => (
                      <li key={g.name}>
                        <a
                          href={g.href}
                          className={buttonClassName({
                            variant: "secondary",
                            size: "sm",
                          })}
                        >
                          Open in {g.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                  <p className="text-caption text-muted">{copy.phoneHint}</p>
                </div>
              </>
            )}
            <div>
              <ConnectButton />
            </div>
          </div>
        </Section>
      </li>

      <li>
        <Section
          eyebrow={copy.eyebrow(2)}
          title={copy.step2}
          actions={funds.step === "first_buy" ? done : null}
        >
          <div className="flex flex-col gap-4">
            {!address ? null : funds.loading ? (
              <p role="status" className={muted}>
                {copy.balancesLoading}
              </p>
            ) : funds.error || funds.sol === null || funds.usdc === null ? (
              <Callout tone="warning">{copy.balancesUnavailable}</Callout>
            ) : (
              <div className="flex flex-col gap-2 rounded-tile border border-line bg-raised p-4">
                <p className="text-small font-medium leading-body text-ink tabular-nums">
                  {copy.balances(sol(funds.sol), usdc(funds.usdc))}
                </p>
                <p className={muted}>
                  {copy.solNeeded(suggestion?.tokens ?? 1, sol(funds.needed))}
                </p>
                <p
                  className={`text-small leading-body ${funds.sol >= funds.needed ? "text-up" : "text-warning"}`}
                >
                  {funds.sol >= funds.needed
                    ? copy.solOk
                    : copy.solShort(sol(funds.needed - funds.sol))}
                </p>
                {funds.usdc === 0n ? (
                  <p className="text-small leading-body text-warning">
                    {copy.usdcNone}
                  </p>
                ) : null}
              </div>
            )}
            <p className={muted}>{copy.fund}</p>
            <p className={muted}>{copy.usdcLimit(capText)}</p>
          </div>
        </Section>
      </li>

      <li>
        <Section eyebrow={copy.eyebrow(3)} title={copy.step3}>
          <div className="flex flex-col gap-4">
            {paused ? <Callout tone="warning">{copy.paused}</Callout> : null}
            {suggestion ? (
              <div className="flex flex-col gap-3 rounded-tile border border-line bg-raised p-4">
                <p className="font-display text-title text-ink">
                  {copy.suggestion(suggestion.name, suggestion.tokens)}
                </p>
                <p className={muted}>{copy.suggestionWhy}</p>
                <p className={muted}>{copy.gates}</p>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <Link
                    href={routes.basket(suggestion.id)}
                    className={buttonClassName({ variant: "solid" })}
                  >
                    {copy.open}
                  </Link>
                  <Link
                    href={routes.markets}
                    className={buttonClassName({ variant: "ghost" })}
                  >
                    {copy.orStock}
                  </Link>
                </div>
              </div>
            ) : (
              <p className={body}>
                {copy.suggestionNone}{" "}
                <Link
                  href={routes.markets}
                  className="rounded-badge underline underline-offset-2 focus-ring"
                >
                  {copy.orStock}
                </Link>
              </p>
            )}
          </div>
        </Section>
      </li>
    </ol>
  );
}
