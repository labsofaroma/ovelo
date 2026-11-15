import { expect, test } from "@playwright/test";
import { NOTIFY_SINK_URL } from "../fork/notify-sink";

/**
 * M11 Step 1 (fork E2E, part 2, after the purchase specs): the worker turns the fork purchases'
 * receipts into notifications and delivers each exactly once to the opted-in channel, however
 * often it runs.
 */
type Delivery = {
  channel: string;
  eventId?: string;
  message?: { title: string; body: string; url: string };
};

test("a fork purchase produces one notification, delivered once", async ({
  request,
}) => {
  const run = () =>
    request.post("/api/v1/notifications/deliver", {
      headers: {
        authorization: `Bearer ${process.env.OVELO_NOTIFY_WORKER_SECRET}`,
      },
      data: {},
    });
  expect(
    (
      await request.post("/api/v1/notifications/deliver", { data: {} })
    ).status(),
  ).toBe(401);
  const first = await run();
  expect(first.status()).toBe(200);
  expect(await first.json()).toMatchObject({ paused: false });
  await run();
  await run();
  const sink = (await (
    await request.get(NOTIFY_SINK_URL)
  ).json()) as Delivery[];
  const deliveries = sink.filter((d) => d.channel === "telegram" && d.eventId);
  const confirmed = deliveries.filter(
    (d) => d.message?.title === "Purchase confirmed",
  );
  expect(confirmed.length).toBeGreaterThan(0);
  const stock = process.env.E2E_STOCK_SYMBOL ?? "AAPLx";
  expect(confirmed.some((d) => d.message!.body.startsWith(`${stock}:`))).toBe(
    true,
  );
  for (const d of confirmed) {
    expect(d.message!.body).toMatch(
      / USDC spent\. Confirmed on Solana mainnet\.$/,
    );
    expect(d.message!.url).toMatch(/^https:\/\/solscan\.io\/tx\//);
  }
  const ids = deliveries.map((d) => d.eventId);
  expect(new Set(ids).size).toBe(ids.length);
});
