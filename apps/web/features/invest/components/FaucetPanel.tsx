"use client";

import { Button } from "@ovelo/ui";
import { CheckCircle2, Coins, ExternalLink, OctagonAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { assertSignerCluster } from "../../wallet/cluster";
import { useSigner } from "../../wallet/context";
import { errorMessage, investApi } from "../api";
import { explorerUrl, toBase64 } from "../amounts";
import { faucetMessage, type FaucetResponse } from "../schema";
import { formatRaw } from "../server/format";

/**
 * Devnet faucet (B6): Cloudflare Turnstile in the page, a wallet-signed claim, then the server
 * mints a fixed amount of test USD and tops up a little SOL. Every refusal shows the server's
 * message (limits, budget, human check).
 */

type TurnstileApi = {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    },
  ) => string;
  reset: (id?: string) => void;
};
const turnstileOf = () =>
  (window as unknown as { turnstile?: TurnstileApi }).turnstile;

const SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadTurnstile(nonce: string | null): Promise<TurnstileApi> {
  const ready = turnstileOf();
  if (ready) return Promise.resolve(ready);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SCRIPT_URL}"]`,
    );
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () =>
      turnstileOf()
        ? resolve(turnstileOf()!)
        : reject(new Error("Turnstile did not load.")),
    );
    script.addEventListener("error", () =>
      reject(new Error("Turnstile could not be loaded.")),
    );
    if (!existing) {
      script.src = SCRIPT_URL;
      script.async = true;
      if (nonce) script.nonce = nonce;
      document.head.appendChild(script);
    }
  });
}

export function FaucetPanel({
  siteKey,
  nonce,
  cluster,
  explorerRpcUrl,
  fundingSymbol,
  fundingDecimals,
  amountRaw,
}: {
  /** The faucet's fixed test USD amount (server constant), raw units. */
  amountRaw: string;
  siteKey: string | null;
  nonce: string | null;
  cluster: "devnet" | "localnet";
  explorerRpcUrl: string;
  fundingSymbol: string;
  fundingDecimals: number;
}) {
  const signer = useSigner();
  const client = useQueryClient();
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<{ api: TurnstileApi; id: string } | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "signing" | "sending">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FaucetResponse | null>(null);

  useEffect(() => {
    if (!siteKey || !box.current || widget.current) return;
    let live = true;
    loadTurnstile(nonce)
      .then((api) => {
        if (!live || !box.current) return;
        const id = api.render(box.current, {
          sitekey: siteKey,
          callback: setToken,
          "expired-callback": () => setToken(null),
          "error-callback": () =>
            setError("The human check could not run. Reload the page."),
        });
        widget.current = { api, id };
      })
      .catch((e: unknown) => setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [siteKey, nonce]);

  if (!siteKey)
    return (
      <section
        data-testid="faucet-unconfigured"
        className="flex gap-3 rounded-tile border border-line bg-raised px-4 py-3 text-small"
      >
        <Coins className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
        <div className="flex flex-col gap-1">
          <h4 className="font-semibold text-ink">Test tokens</h4>
          <p className="text-muted">
            The devnet faucet is not configured on this deployment.
          </p>
        </div>
      </section>
    );

  const claim = async () => {
    setError(null);
    setResult(null);
    try {
      assertSignerCluster(signer, cluster);
      if (!signer!.signMessage)
        throw new Error(
          "This wallet cannot sign messages, so it cannot claim test tokens.",
        );
      if (!token) throw new Error("Complete the human check first.");
      setStatus("signing");
      const issuedAt = String(Math.floor(Date.now() / 1000));
      const signature = await signer!.signMessage(
        new TextEncoder().encode(
          faucetMessage(signer!.address, issuedAt, cluster),
        ),
      );
      setStatus("sending");
      const response = await investApi.faucet({
        wallet: signer!.address,
        turnstileToken: token,
        issuedAt,
        signature: toBase64(signature),
      });
      setResult(response);
      await client.invalidateQueries({ queryKey: ["invest", "plans"] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setStatus("idle");
      setToken(null);
      widget.current?.api.reset(widget.current.id);
    }
  };

  return (
    <section
      aria-labelledby="faucet-title"
      className="flex flex-col gap-4 rounded-tile border border-line bg-raised p-4 text-small md:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-warning-soft text-warning">
          <Coins className="size-4.5" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <h4 id="faucet-title" className="font-medium text-ink">
            Test tokens
          </h4>
          <p className="leading-body text-muted">
            Claim {formatRaw(BigInt(amountRaw), fundingDecimals)}{" "}
            {fundingSymbol} (test USD, no value) once a day, plus a little
            devnet SOL for fees if your wallet is low. Your wallet signs a short
            claim message; no funds move from it.
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div ref={box} data-testid="faucet-turnstile" />
        <Button
          variant="secondary"
          data-testid="faucet-claim"
          onClick={() => void claim()}
          loading={status !== "idle"}
          disabled={!signer}
        >
          Claim test tokens
        </Button>
      </div>
      <p
        role="status"
        aria-live="polite"
        className="text-caption text-muted empty:hidden"
      >
        {status === "signing"
          ? "Sign the claim in your wallet."
          : status === "sending"
            ? "Sending test tokens…"
            : ""}
      </p>
      {error ? (
        <p
          role="alert"
          data-testid="faucet-error"
          className="flex items-center gap-2 text-down"
        >
          <OctagonAlert className="size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      ) : null}
      {result ? (
        <p
          data-testid="faucet-result"
          role="status"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-up"
        >
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          <span>
            Received {formatRaw(BigInt(result.testUsdRaw), fundingDecimals)}{" "}
            {fundingSymbol}
            {result.lamports !== "0"
              ? ` and ${formatRaw(BigInt(result.lamports), 9)} SOL`
              : ""}
            .
          </span>{" "}
          <a
            className="inline-flex items-center gap-1 rounded-badge text-muted underline underline-offset-4 hover:text-ink focus-ring"
            href={explorerUrl(result.signature, cluster, explorerRpcUrl)}
            target="_blank"
            rel="noreferrer"
          >
            Transaction {result.signature.slice(0, 8)}…
            <ExternalLink className="size-3" aria-hidden />
          </a>
        </p>
      ) : null}
    </section>
  );
}
