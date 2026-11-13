import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  flowReducer,
  initialFlow,
  quoteClock,
  type FlowEvent,
  type FlowState,
  type LiveQuote,
  type PaperQuote,
} from "./flow";
import type { TradeRecordView } from "./schema";

const NOW = 1_800_000_000_000;
const live = (expiresAt = NOW + 60_000) =>
  ({
    channel: "live",
    requestId: "r1",
    expiresAt,
    quote: { quotedAt: new Date(NOW).toISOString() },
  }) as unknown as LiveQuote;
const paper = (): PaperQuote => ({
  channel: "paper",
  kind: "spot",
  amountUsd: "10",
  legs: [],
  pricesObservedAt: null,
  quotedAt: new Date(NOW).toISOString(),
  expiresAt: NOW + 60_000,
});
const record = (
  status: TradeRecordView["status"],
  id = "r1",
): TradeRecordView => ({
  id,
  status,
  mode: "single",
  signatures: ["s"],
  bundleId: null,
  submittedAt: "t",
  updatedAt: "t",
  slot: null,
  error: null,
});
const run = (events: FlowEvent[], from: FlowState = initialFlow) =>
  events.reduce(flowReducer, from);

describe("trade flow", () => {
  it("quote → review → sign → submit → confirm", () => {
    const state = run([
      { type: "QUOTE" },
      { type: "QUOTED", quote: live() },
      { type: "SIGN", now: NOW + 1000 },
      { type: "SIGNED" },
      { type: "SUBMITTED", record: record("pending") },
    ]);
    expect(state).toMatchObject({ step: "confirming", tradeId: "r1" });
    expect(
      flowReducer(state, { type: "STATUS", record: record("confirmed") }),
    ).toMatchObject({
      step: "done",
      outcome: "confirmed",
    });
  });

  it("an expired quote cannot be signed: it moves to 'expired' instead", () => {
    const review = run([
      { type: "QUOTE" },
      { type: "QUOTED", quote: live(NOW + 5000) },
    ]);
    expect(
      flowReducer(review, { type: "SIGN", now: NOW + 5000 }),
    ).toMatchObject({ step: "expired" });
    expect(
      flowReducer(review, { type: "TICK", now: NOW + 6000 }),
    ).toMatchObject({ step: "expired" });
    expect(flowReducer(review, { type: "TICK", now: NOW + 1000 })).toBe(review);
  });

  it("property: SIGN never reaches 'signing' at or after expiry", () => {
    fc.assert(
      fc.property(fc.integer({ min: -60_000, max: 120_000 }), (offset) => {
        const review = run([
          { type: "QUOTE" },
          { type: "QUOTED", quote: live(NOW) },
        ]);
        const next = flowReducer(review, { type: "SIGN", now: NOW + offset });
        expect(next.step).toBe(offset < 0 ? "signing" : "expired");
      }),
    );
  });

  it("cancel works before signing, never while the wallet signs or the trade is in flight", () => {
    const review = run([{ type: "QUOTE" }, { type: "QUOTED", quote: live() }]);
    expect(flowReducer(review, { type: "CANCEL" })).toEqual(initialFlow);
    const signing = flowReducer(review, { type: "SIGN", now: NOW });
    expect(flowReducer(signing, { type: "CANCEL" })).toBe(signing);
    const confirming = run(
      [{ type: "SIGNED" }, { type: "SUBMITTED", record: record("unknown") }],
      signing,
    );
    expect(flowReducer(confirming, { type: "CANCEL" })).toBe(confirming);
    // A transport failure while tracking is not a safe retry: stay in confirming.
    expect(
      flowReducer(confirming, {
        type: "FAIL",
        error: { code: "X", message: "x" },
      }),
    ).toBe(confirming);
  });

  it("recovers an in-flight trade after a refresh, and ignores other trades' status", () => {
    const recovering = flowReducer(initialFlow, {
      type: "RECOVER",
      tradeId: "r9",
    });
    expect(recovering).toEqual({
      step: "confirming",
      tradeId: "r9",
      record: null,
    });
    expect(
      flowReducer(recovering, {
        type: "STATUS",
        record: record("confirmed", "other"),
      }),
    ).toBe(recovering);
    expect(
      flowReducer(recovering, {
        type: "STATUS",
        record: record("failed", "r9"),
      }),
    ).toMatchObject({
      outcome: "failed",
    });
  });

  it("an unknown recovered id stops tracking with an explanation", () => {
    const recovering = flowReducer(initialFlow, {
      type: "RECOVER",
      tradeId: "gone",
    });
    expect(flowReducer(recovering, { type: "UNTRACKED" })).toMatchObject({
      step: "error",
      error: { code: "NOT_FOUND" },
    });
    expect(flowReducer(initialFlow, { type: "UNTRACKED" })).toBe(initialFlow);
  });

  it("paper mode never enters signing; it fills locally", () => {
    const review = run([{ type: "QUOTE" }, { type: "QUOTED", quote: paper() }]);
    expect(flowReducer(review, { type: "SIGN", now: NOW })).toBe(review);
    expect(flowReducer(review, { type: "PAPER_FILLED" })).toMatchObject({
      step: "done",
      outcome: "paper",
    });
  });

  it("errors keep the quote for context; a stray event in the wrong step is ignored", () => {
    const review = run([{ type: "QUOTE" }, { type: "QUOTED", quote: live() }]);
    expect(
      flowReducer(review, { type: "FAIL", error: { code: "C", message: "m" } }),
    ).toMatchObject({
      step: "error",
      quote: { requestId: "r1" },
    });
    expect(flowReducer(initialFlow, { type: "SIGNED" })).toBe(initialFlow);
    expect(flowReducer(initialFlow, { type: "QUOTED", quote: live() })).toBe(
      initialFlow,
    );
  });

  it("quoteClock reports age and remaining seconds", () => {
    expect(quoteClock(live(NOW + 60_000), NOW + 15_500)).toEqual({
      ageSeconds: 15,
      remainingSeconds: 45,
    });
    expect(quoteClock(live(NOW), NOW + 1)).toEqual({
      ageSeconds: 0,
      remainingSeconds: 0,
    });
  });
});
