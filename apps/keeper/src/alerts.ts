import type { Logger } from "./log";
import type { KeeperRedis } from "./store";

/**
 * Operator alerts to a webhook in Slack or Discord format (B5). Each alert has a kind and a
 * subject; the same (kind, subject) is sent at most once per de-duplication window, and at most
 * MAX_PER_MINUTE alerts leave per minute in total. Every alert is also logged. A webhook failure
 * is logged and reported, never thrown into the run.
 */

export type AlertKind =
  | "installment_failed"
  | "installment_skipped"
  | "keeper_balance_low"
  | "hermes_unavailable"
  | "rpc_degraded"
  | "dead_letter_growth";

export type Alert = {
  kind: AlertKind;
  /** What the alert is about (a plan and period, the keeper, a host); part of the dedup key. */
  subject: string;
  title: string;
  details: Record<string, string>;
};

export type AlertOutcome =
  "sent" | "deduplicated" | "rate_limited" | "logged_only" | "failed";

export const DEDUP_SECONDS: Record<AlertKind, number> = {
  installment_failed: 3_600,
  installment_skipped: 86_400,
  keeper_balance_low: 3_600,
  hermes_unavailable: 900,
  rpc_degraded: 900,
  dead_letter_growth: 3_600,
};
export const MAX_PER_MINUTE = 20;

const SEVERITY: Record<AlertKind, string> = {
  installment_failed: "error",
  installment_skipped: "warning",
  keeper_balance_low: "warning",
  hermes_unavailable: "warning",
  rpc_degraded: "warning",
  dead_letter_growth: "error",
};

export function formatAlert(
  format: "slack" | "discord",
  alert: Alert,
  cluster: string,
): unknown {
  const lines = Object.entries(alert.details).map(([k, v]) => `• ${k}: ${v}`);
  const heading = `[ovelo-keeper ${cluster}] ${SEVERITY[alert.kind].toUpperCase()} ${alert.kind}: ${alert.title}`;
  if (format === "discord")
    return { content: [heading, ...lines].join("\n").slice(0, 1_900) };
  return {
    text: heading,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `*${heading}*` } },
      ...(lines.length
        ? [
            {
              type: "section",
              text: { type: "mrkdwn", text: lines.join("\n") },
            },
          ]
        : []),
    ],
  };
}

export type AlertDeps = {
  redis: KeeperRedis;
  log: Logger;
  cluster: string;
  webhookUrl?: string;
  format: "slack" | "discord";
  fetch?: typeof fetch;
  now?: () => Date;
};

export async function sendAlert(
  deps: AlertDeps,
  alert: Alert,
): Promise<AlertOutcome> {
  const dedupKey = `alert:dedup:${alert.kind}:${alert.subject}`;
  const fresh = await deps.redis.set(dedupKey, "1", {
    nx: true,
    ex: DEDUP_SECONDS[alert.kind],
  });
  if (fresh !== "OK") {
    deps.log.debug(
      { alert: alert.kind, subject: alert.subject },
      "alert deduplicated",
    );
    return "deduplicated";
  }
  const minute = Math.floor(
    (deps.now ?? (() => new Date()))().getTime() / 60_000,
  );
  const rateKey = `alert:rate:${minute}`;
  const count = await deps.redis.incr(rateKey);
  if (count === 1) await deps.redis.expire(rateKey, 120);
  deps.log.warn(
    {
      alert: alert.kind,
      subject: alert.subject,
      title: alert.title,
      details: alert.details,
    },
    "keeper alert",
  );
  if (count > MAX_PER_MINUTE) {
    deps.log.error(
      { alert: alert.kind, count },
      "alert rate limit reached; not sent",
    );
    return "rate_limited";
  }
  if (!deps.webhookUrl) return "logged_only";
  try {
    const response = await (deps.fetch ?? fetch)(deps.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formatAlert(deps.format, alert, deps.cluster)),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      deps.log.error(
        { alert: alert.kind, status: response.status },
        "alert webhook refused",
      );
      return "failed";
    }
    return "sent";
  } catch (err) {
    deps.log.error({ alert: alert.kind, err }, "alert webhook unreachable");
    return "failed";
  }
}
