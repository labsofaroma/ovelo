import { describe, expect, it, vi } from "vitest";
import { formatAlert, MAX_PER_MINUTE, sendAlert, type Alert } from "./alerts";
import { memoryRedis, silent } from "./test/world";

const alert = (subject = "plan:3"): Alert => ({
  kind: "installment_failed",
  subject,
  title: "Installment failed",
  details: { code: "X" },
});

describe("alerts", () => {
  it("formats for Slack and Discord", () => {
    expect(formatAlert("slack", alert(), "devnet")).toMatchObject({
      text: expect.stringMatching(
        /^\[aroma-keeper devnet\] ERROR installment_failed: Installment failed/,
      ),
    });
    expect(formatAlert("discord", alert(), "devnet")).toEqual({
      content: expect.stringContaining("• code: X"),
    });
  });

  it("sends once per (kind, subject) window, logs when no webhook, reports webhook failures", async () => {
    const redis = memoryRedis();
    const fetch = vi.fn(async () => new Response("ok"));
    const deps = {
      redis,
      log: silent,
      cluster: "devnet",
      format: "slack" as const,
      webhookUrl: "https://hooks.example/x",
      fetch: fetch as unknown as typeof globalThis.fetch,
    };
    expect(await sendAlert(deps, alert())).toBe("sent");
    expect(await sendAlert(deps, alert())).toBe("deduplicated");
    expect(await sendAlert(deps, alert("plan:4"))).toBe("sent");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      await sendAlert({ ...deps, webhookUrl: undefined }, alert("plan:5")),
    ).toBe("logged_only");
    const refusing = vi.fn(async () => new Response("no", { status: 500 }));
    expect(
      await sendAlert(
        { ...deps, fetch: refusing as unknown as typeof globalThis.fetch },
        alert("plan:6"),
      ),
    ).toBe("failed");
    const down = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(
      await sendAlert(
        { ...deps, fetch: down as unknown as typeof globalThis.fetch },
        alert("plan:7"),
      ),
    ).toBe("failed");
  });

  it("rate-limits a storm of distinct alerts", async () => {
    const redis = memoryRedis();
    const deps = {
      redis,
      log: silent,
      cluster: "devnet",
      format: "discord" as const,
      now: () => new Date("2026-11-14T00:00:00Z"),
    };
    const outcomes = [];
    for (let i = 0; i < MAX_PER_MINUTE + 3; i += 1)
      outcomes.push(await sendAlert(deps, alert(`p:${i}`)));
    expect(outcomes.filter((o) => o === "rate_limited")).toHaveLength(3);
  });
});
