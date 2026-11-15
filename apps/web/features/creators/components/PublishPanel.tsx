"use client";

import { Button, Field, Input } from "@ovelo/ui";
import Link from "next/link";
import { useState } from "react";
import { ConnectButton } from "../../wallet/ConnectButton";
import { useWallet } from "../../wallet/context";
import { flowErrorMessage, UNSUPPORTED_WALLET } from "../publish-flow";
import type { FlowStep } from "../publish-flow";
import { useIsCreator, usePublishMutation } from "../queries";
import { creatorRoutes } from "../routes";
import type { BasketDraftInput } from "../schema";

const STEP_TEXT: Record<
  Exclude<FlowStep["step"], "idle" | "done">,
  Record<"redeem" | "publish" | "delete", string>
> = {
  challenge: {
    redeem: "Preparing your invite for signing…",
    publish: "Preparing the basket for signing…",
    delete: "Preparing…",
  },
  signing: {
    redeem:
      "Confirm the invite in your wallet. It is a message, not a transaction.",
    publish:
      "Confirm the basket in your wallet. It is a message, not a transaction: no funds move.",
    delete: "Confirm in your wallet.",
  },
  submitting: {
    redeem: "Redeeming your invite…",
    publish: "Publishing…",
    delete: "Archiving…",
  },
};

export interface PublishPanelProps {
  /** Reasons the draft cannot be published yet (from the shared zod schema). */
  problems: readonly string[];
  basket: BasketDraftInput;
  /** Set when publishing a new version of an existing basket. */
  basketId?: string;
  onPublished: () => void;
}

/**
 * Connect → (first time) redeem an invite → sign the challenge → publish (M5b B2). Wallet
 * signatures are messages, never transactions; the server checks ownership, the invite and the
 * weights again.
 */
export function PublishPanel({
  problems,
  basket,
  basketId,
  onPublished,
}: PublishPanelProps) {
  const wallet = useWallet();
  const signer = wallet.status === "connected" ? wallet.signer : null;
  const creator = useIsCreator(signer?.address ?? null);
  const publish = usePublishMutation(signer);
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [social, setSocial] = useState("");

  const needsInvite = creator.data === false;
  const busy = publish.isPending;
  const inviteReady = code.trim().length > 0 && displayName.trim().length > 0;

  if (publish.isSuccess)
    return (
      <div role="status" className="flex flex-col gap-2">
        <p className="text-body font-semibold">
          Published {publish.data.name} ({publish.data.ticker}), version{" "}
          {publish.data.version}.
        </p>
        <div className="flex flex-wrap gap-3 text-small">
          <Link
            className="underline"
            href={creatorRoutes.basket(publish.data.id)}
          >
            View the basket
          </Link>
          <Link className="underline" href={creatorRoutes.directory}>
            Creator directory
          </Link>
        </div>
      </div>
    );

  function submit() {
    publish.mutate(
      {
        basket,
        ...(basketId ? { basketId } : {}),
        ...(needsInvite
          ? {
              invite: {
                code: code.trim(),
                profile: {
                  displayName: displayName.trim(),
                  ...(social.trim() ? { social: social.trim() } : {}),
                },
              },
            }
          : {}),
      },
      { onSuccess: onPublished },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {!signer ? (
        <div className="flex flex-col gap-2">
          <p className="text-small">
            Connect an invited creator wallet. Publishing asks it to sign a
            message; it never sends a transaction.
          </p>
          <div>
            <ConnectButton />
          </div>
          {wallet.error ? (
            <p role="alert" className="text-small text-down">
              {wallet.error}
            </p>
          ) : null}
        </div>
      ) : !signer.signMessage ? (
        <p role="alert" className="text-small text-down">
          {UNSUPPORTED_WALLET}
        </p>
      ) : creator.isPending ? (
        <p role="status" className="text-small text-muted">
          Checking whether this wallet is a creator…
        </p>
      ) : creator.isError ? (
        <p role="alert" className="text-small text-down">
          Creator status is unavailable right now. Try again shortly.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-small">
            <span>Publishing as</span>
            <ConnectButton />
          </div>
          {needsInvite ? (
            <fieldset className="flex flex-col gap-3 rounded-panel border border-line p-3">
              <legend className="px-1 text-small font-semibold">
                Redeem your creator invite
              </legend>
              <p className="text-caption text-muted">
                This wallet is not a creator yet. Invites are single-use and
                expire; the code is checked when you publish.
              </p>
              <Field label="Invite code" required>
                <Input
                  value={code}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setCode(event.target.value)}
                />
              </Field>
              <Field
                label="Display name"
                hint="Shown on your baskets."
                required
              >
                <Input
                  value={displayName}
                  maxLength={50}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </Field>
              <Field
                label="Profile link"
                hint="Optional https link (X, Farcaster, a website)."
              >
                <Input
                  value={social}
                  type="url"
                  inputMode="url"
                  maxLength={200}
                  onChange={(event) => setSocial(event.target.value)}
                />
              </Field>
            </fieldset>
          ) : null}
          <div>
            <Button
              type="button"
              loading={busy}
              disabled={
                busy || problems.length > 0 || (needsInvite && !inviteReady)
              }
              onClick={submit}
            >
              {needsInvite
                ? "Redeem invite, sign and publish"
                : basketId
                  ? "Sign and publish a new version"
                  : "Sign and publish"}
            </Button>
          </div>
        </>
      )}
      <p role="status" aria-live="polite" className="text-caption text-muted">
        {busy && publish.step.step !== "idle" && publish.step.step !== "done"
          ? STEP_TEXT[publish.step.step][publish.step.purpose]
          : ""}
      </p>
      {publish.isError ? (
        <p role="alert" className="text-small text-down">
          {flowErrorMessage(publish.error)}
        </p>
      ) : null}
    </div>
  );
}
