import { ExternalLink, Wallet2 } from "lucide-react";
import { Section, buttonClassName } from "@ovelo/ui";
import { portfolioCopy } from "../copy";

const w = portfolioCopy.wallet;

/** The last card of /portfolio: which wallet is read, and where to see it on the explorer. */
export function WalletCard({ address }: { address: string }) {
  return (
    <Section title={w.title}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <span className="grid size-12 shrink-0 place-items-center rounded-full border border-line bg-raised-2">
          <Wallet2 className="size-5 text-muted" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-small font-medium text-ink">{w.connected}</p>
          <p className="break-all font-mono text-caption text-muted">
            {address}
          </p>
          <p className="text-small text-muted">{w.body}</p>
        </div>
        <a
          href={`https://solscan.io/account/${address}`}
          target="_blank"
          rel="noreferrer"
          className={buttonClassName({
            variant: "secondary",
            size: "sm",
            className: "w-fit",
          })}
        >
          {w.explorer}
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </div>
    </Section>
  );
}
