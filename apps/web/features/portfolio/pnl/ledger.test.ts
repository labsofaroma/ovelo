import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { apply, EMPTY, replay, type LedgerEvent } from "./ledger";

const amount = fc.bigInt({ min: 1n, max: 10n ** 18n });

/** A random history that never takes out more than is held. */
const history = fc
  .array(
    fc.record({
      kind: fc.constantFrom("buy", "sell", "transfer_out"),
      quantity: amount,
      money: fc.bigInt({ min: 0n, max: 10n ** 15n }),
      fraction: fc.integer({ min: 1, max: 100 }),
    }),
    { maxLength: 40 },
  )
  .map((steps) => {
    const events: LedgerEvent[] = [];
    let held = 0n;
    for (const step of steps) {
      if (step.kind === "buy" || held === 0n) {
        events.push({ kind: "buy", quantity: step.quantity, cost: step.money });
        held += step.quantity;
      } else {
        const quantity = (held * BigInt(step.fraction)) / 100n || 1n;
        events.push(
          step.kind === "sell"
            ? { kind: "sell", quantity, proceeds: step.money }
            : { kind: "transfer_out", quantity },
        );
        held -= quantity;
      }
    }
    return events;
  });

describe("average-cost ledger (properties)", () => {
  it("the cost basis is never negative and an empty position carries no cost", () => {
    fc.assert(
      fc.property(history, (events) => {
        let position = EMPTY;
        for (const event of events) {
          position = apply(position, event);
          expect(position.cost >= 0n).toBe(true);
          expect(position.quantity >= 0n).toBe(true);
          if (position.quantity === 0n) expect(position.cost).toBe(0n);
        }
      }),
    );
  });

  it("buying then selling everything: quantity 0 and realized = proceeds − cost", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(amount, fc.bigInt({ min: 0n, max: 10n ** 15n })), {
          minLength: 1,
          maxLength: 10,
        }),
        fc.bigInt({ min: 0n, max: 10n ** 16n }),
        (buys, proceeds) => {
          const quantity = buys.reduce((s, [q]) => s + q, 0n);
          const cost = buys.reduce((s, [, c]) => s + c, 0n);
          const position = replay([
            ...buys.map(([q, c]) => ({
              kind: "buy" as const,
              quantity: q,
              cost: c,
            })),
            { kind: "sell", quantity, proceeds },
          ]);
          expect(position.quantity).toBe(0n);
          expect(position.cost).toBe(0n);
          expect(position.realized).toBe(proceeds - cost);
        },
      ),
    );
  });

  it("cost is conserved: remaining + removed by sells and transfers = total bought", () => {
    fc.assert(
      fc.property(history, (events) => {
        const position = replay(events);
        const bought = events.reduce(
          (s, e) => s + (e.kind === "buy" ? e.cost : 0n),
          0n,
        );
        const proceeds = events.reduce(
          (s, e) => s + (e.kind === "sell" ? e.proceeds : 0n),
          0n,
        );
        expect(
          position.cost +
            position.transferredCost +
            (proceeds - position.realized),
        ).toBe(bought);
      }),
    );
  });

  it("works on bigint only (no float ever appears)", () => {
    fc.assert(
      fc.property(history, (events) => {
        const position = replay(events);
        for (const value of Object.values(position))
          expect(typeof value).toBe("bigint");
      }),
    );
  });
});

describe("average-cost ledger (examples and refusals)", () => {
  it("a partial sale removes cost at the average, rounded down", () => {
    const position = replay([
      { kind: "buy", quantity: 3n, cost: 10n },
      { kind: "sell", quantity: 1n, proceeds: 5n },
    ]);
    // removed = floor(10 × 1 / 3) = 3; the remainder stays with the 2 units held.
    expect(position).toEqual({
      quantity: 2n,
      cost: 7n,
      realized: 2n,
      transferredCost: 0n,
    });
  });

  it("refuses taking out more than is held, and non-positive quantities", () => {
    expect(() =>
      replay([{ kind: "sell", quantity: 1n, proceeds: 0n }]),
    ).toThrow(RangeError);
    expect(() => apply(EMPTY, { kind: "buy", quantity: 0n, cost: 1n })).toThrow(
      RangeError,
    );
  });
});
