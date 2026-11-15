import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { AlertTriangle, Info, OctagonAlert } from "lucide-react";
import { cn } from "../lib/cn";

export type Freshness = "fresh" | "stale" | "unavailable";

export interface SourceStampProps extends HTMLAttributes<HTMLSpanElement> {
  /** Who the figure comes from, e.g. "Pyth" or "Jupiter". */
  source: string;
  /** When it was observed. Omit only when `state` is "unavailable". */
  observedAt?: Date | number | string | null;
  state?: Freshness;
  /** Formats the time. Default: local hh:mm. Injectable for tests and other locales. */
  formatTime?: (date: Date) => string;
}

const defaultTime = (date: Date) =>
  date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/**
 * Where and when a figure was observed (PRODUCT.md: real data with source and timestamp, and
 * stale or unavailable data shown as such). Put one next to every price or stat.
 */
export const SourceStamp = forwardRef<HTMLSpanElement, SourceStampProps>(
  function SourceStamp(
    {
      source,
      observedAt,
      state = "fresh",
      formatTime = defaultTime,
      className,
      ...props
    },
    ref,
  ) {
    const date =
      observedAt === null || observedAt === undefined
        ? null
        : new Date(observedAt);
    const valid = date && !Number.isNaN(date.getTime()) ? date : null;
    const shown: Freshness =
      state === "fresh" && !valid ? "unavailable" : state;
    return (
      <span
        ref={ref}
        data-state={shown}
        className={cn(
          "inline-flex flex-wrap items-center gap-1.5 text-caption text-muted tabular-nums",
          className,
        )}
        {...props}
      >
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 rounded-full",
            shown === "fresh" && "bg-up",
            shown === "stale" && "bg-warning",
            shown === "unavailable" && "bg-border-strong",
          )}
        />
        <span>{source}</span>
        {shown !== "unavailable" && valid && (
          <>
            <span aria-hidden="true">·</span>
            <time dateTime={valid.toISOString()}>{formatTime(valid)}</time>
          </>
        )}
        {shown === "stale" && <span className="text-warning">Stale</span>}
        {shown === "unavailable" && <span>Unavailable</span>}
      </span>
    );
  },
);

export type NetworkKind = "mainnet-spot" | "devnet-test" | "paper";

const NETWORK: Record<NetworkKind, { label: string; className: string }> = {
  "mainnet-spot": {
    label: "Mainnet · spot purchase",
    className: "border-(--ovelo-pill-border) bg-pill text-ink",
  },
  "devnet-test": {
    label: "Devnet · test tokens only",
    className: "border-transparent bg-warning-soft text-warning",
  },
  paper: {
    label: "Paper · practice, no real funds",
    className: "border-line bg-raised-2 text-muted",
  },
};

/**
 * Says which network a surface acts on (PRODUCT.md: always label mainnet spot, devnet test and
 * paper practice). The wording is fixed on purpose.
 */
export function NetworkBadge({
  kind,
  className,
}: {
  kind: NetworkKind;
  className?: string;
}) {
  const { label, className: tone } = NETWORK[kind];
  return (
    <span
      data-network={kind}
      className={cn(
        "inline-flex min-h-6.5 w-fit items-center gap-1.5 rounded-full border px-3 py-0.5 text-caption font-medium",
        tone,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          kind === "mainnet-spot" && "bg-up",
          kind === "devnet-test" && "bg-warning",
          kind === "paper" && "bg-muted",
        )}
      />
      {label}
    </span>
  );
}

export interface StatTileProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "title"
> {
  label: ReactNode;
  /** The figure. Pass "—" (or a text) when unavailable; never a placeholder number. */
  value: ReactNode;
  /** Secondary line, e.g. a Change or a unit. */
  detail?: ReactNode;
  /** Usually a SourceStamp. */
  source?: ReactNode;
  size?: "md" | "lg";
}

/** One labelled figure inside a card. */
export const StatTile = forwardRef<HTMLDivElement, StatTileProps>(
  function StatTile(
    { label, value, detail, source, size = "md", className, ...props },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={cn(
          "flex min-w-0 flex-col gap-2 rounded-tile border border-line bg-raised p-4",
          className,
        )}
        {...props}
      >
        <span className="text-caption text-muted">{label}</span>
        <span
          className={cn(
            "font-display font-medium tabular-nums tracking-[-0.02em] text-ink",
            size === "lg" ? "text-[2.25rem] leading-none" : "text-title",
          )}
        >
          {value}
        </span>
        {detail && <span className="text-small text-muted">{detail}</span>}
        {source && <span className="mt-auto pt-1">{source}</span>}
      </div>
    );
  },
);

export type CalloutTone = "info" | "warning" | "danger";
const CALLOUT: Record<CalloutTone, { icon: typeof Info; className: string }> = {
  info: { icon: Info, className: "border-line bg-raised text-ink" },
  warning: {
    icon: AlertTriangle,
    className: "border-transparent bg-warning-soft text-ink",
  },
  danger: {
    icon: OctagonAlert,
    className: "border-transparent bg-down-soft text-ink",
  },
};

export interface CalloutProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "title"
> {
  tone?: CalloutTone;
  title?: ReactNode;
}

/** An inline notice. Danger callouts are announced (role="alert"); others are plain notes. */
export const Callout = forwardRef<HTMLDivElement, CalloutProps>(
  function Callout(
    { tone = "info", title, className, children, ...props },
    ref,
  ) {
    const { icon: Icon, className: toneClass } = CALLOUT[tone];
    return (
      <div
        ref={ref}
        role={tone === "danger" ? "alert" : undefined}
        data-tone={tone}
        className={cn(
          "flex gap-3 rounded-tile border px-4 py-3 text-small leading-body",
          toneClass,
          className,
        )}
        {...props}
      >
        <Icon
          aria-hidden="true"
          className={cn(
            "mt-0.5 size-4 shrink-0",
            tone === "info" && "text-muted",
            tone === "warning" && "text-warning",
            tone === "danger" && "text-down",
          )}
        />
        <div className="flex min-w-0 flex-col gap-1">
          {title && <strong className="font-semibold">{title}</strong>}
          {children && <div className="text-muted">{children}</div>}
        </div>
      </div>
    );
  },
);

/** Shown when a list has nothing to show. Offer the next step as `action`. */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-tile border border-dashed border-line px-6 py-10 text-center",
        className,
      )}
    >
      <p className="font-display text-title text-ink">{title}</p>
      {description && (
        <p className="max-w-[48ch] text-small text-muted">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
