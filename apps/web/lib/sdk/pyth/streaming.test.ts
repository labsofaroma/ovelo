import { expect, test } from "vitest";
import type { PythEventSource } from "./streaming";
import { subscribePythPriceFeeds } from "./streaming";
import type { PythPriceData } from "./types";

interface FakeSource extends PythEventSource {
  closed?: boolean;
}

test("Pyth stream accepts only requested fresh ordered confidence-bounded real ticks", () => {
  const id = "a".repeat(64);
  const other = "b".repeat(64);
  let source: FakeSource | undefined;
  let url = "";
  const ticks: PythPriceData[] = [];
  const stop = subscribePythPriceFeeds(
    [id],
    (p) => ticks.push(p),
    () => {},
    {
      now: () => 1000000,
      createEventSource: (u) => {
        url = u;
        const created: FakeSource = {
          onmessage: null,
          onerror: null,
          close() {
            this.closed = true;
          },
        };
        source = created;
        return created;
      },
    },
  );
  const send = (publish_time: number, conf = "1", feed = id) =>
    source?.onmessage?.({
      data: JSON.stringify({
        parsed: [
          { id: feed, price: { price: "1000", conf, expo: -2, publish_time } },
        ],
      }),
    });
  send(999);
  send(998);
  send(900);
  send(1000, "500");
  send(1000, "1", other);
  send(1011);
  send(1000);
  expect(ticks.length).toBe(2);
  expect(ticks[0]!.price).toBe(10);
  expect(ticks[0]!.status).toBe("unknown");
  expect(
    url.startsWith("https://hermes.pyth.network/v2/updates/price/stream?"),
  ).toBeTruthy();
  stop();
  expect(source!.onmessage).toBe(null);
  expect(source!.closed).toBe(true);
  expect(() => subscribePythPriceFeeds(["invalid"], () => {})).toThrow();
  expect(() =>
    subscribePythPriceFeeds([id], () => {}, undefined, {
      endpoint: "http://example.com",
    }),
  ).toThrow();
});
