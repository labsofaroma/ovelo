"use client";

import { Badge, Button, Field, Input } from "@ovelo/ui";
import { useState, type FormEvent } from "react";
import type { Signer } from "../../wallet/context";
import { useRedeemBeta } from "../queries";

/**
 * Private-beta redeem step (REWRITE-PLAN §7.3 W2) in the trade ticket and basket buy. The wallet
 * signs a message bound to the code; nothing moves funds. Shown only while the gate is on and the
 * connected wallet has no access; the server enforces the same gate on every quote and submit.
 */
export function BetaGate({ signer }: { signer: Signer }) {
  const [code, setCode] = useState("");
  const redeem = useRedeemBeta(signer);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (code.trim()) redeem.mutate(code);
  };
  return (
    <div
      role="region"
      aria-label="Private beta access"
      className="mt-4 rounded-tile border border-line bg-raised p-4 text-small"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-ink">Mainnet buying is invite-only</p>
        <Badge tone="warning">Private beta</Badge>
      </div>
      <p className="mt-1.5 leading-body text-muted">
        Ovelo is in a private beta with small limits. To buy with this wallet,
        enter the invite code you were given. Your wallet signs a message to
        link the invite to it; the signature does not move funds. Browsing,
        research and paper practice stay open to everyone.
      </p>
      {signer.signMessage ? (
        <form className="mt-4 grid gap-3" onSubmit={submit}>
          <Field label="Invite code">
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="ovelo-beta-…"
            />
          </Field>
          <Button
            type="submit"
            variant="solid"
            loading={redeem.isPending}
            disabled={!code.trim()}
          >
            Sign to redeem the invite
          </Button>
        </form>
      ) : (
        <p className="mt-2 text-muted">
          This wallet cannot sign messages, so it cannot redeem an invite.
          Connect another wallet to buy on mainnet.
        </p>
      )}
      {redeem.error ? (
        <p role="alert" className="mt-2 text-down">
          {redeem.error.message}
        </p>
      ) : null}
    </div>
  );
}
