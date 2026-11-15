import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/features/creators/test/db";
import { resetEnvCacheForTests } from "@/server/env";
import { stubBaseEnv } from "@/server/test/base-env";
import { makeSigner, memoryStore } from "@/server/test/creator-fixtures";
import { memoryChannel } from "./server/channels/fakes";
import type { NotifyConfig } from "./server/config";
import { setNotifyDepsForTests } from "./server/deps";
import type { NotifyDb } from "./server/outbox";
import { T0 } from "./test/fixtures";

/**
 * M11 Step 1 at route level (PGlite, in-memory nonces, a memory channel): the opt-in is
 * wallet-signed and single-use, the session gates reads and changes, the webhook and worker need
 * their secrets, contact details never come back, and deletes are hard.
 */
const challenge = await import("@/app/api/v1/notifications/challenge/route");
const session = await import("@/app/api/v1/notifications/session/route");
const subs = await import("@/app/api/v1/notifications/subscriptions/route");
const channelRoute =
  await import("@/app/api/v1/notifications/subscriptions/[channel]/route");
const testRoute = await import("@/app/api/v1/notifications/test/route");
const deliver = await import("@/app/api/v1/notifications/deliver/route");
const telegram = await import("@/app/api/v1/notifications/telegram/route");
const config = await import("@/app/api/v1/notifications/config/route");

const SITE = "https://aroma.example";
const WORKER = "w".repeat(40);
const HOOK = "h".repeat(40);
const req = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
  method = "POST",
) =>
  new Request(`${SITE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(`${SITE}${path}`, { headers });
const params = (channel: string) => ({ params: Promise.resolve({ channel }) });

let db: NotifyDb;
let client: PGlite;
let cfg: NotifyConfig;
let mem = memoryChannel("telegram");
let now = T0;
beforeAll(async () => {
  ({ db, client } = await createTestDb());
});
afterAll(async () => client.close());
beforeEach(async () => {
  stubBaseEnv();
  resetEnvCacheForTests();
  await client.exec(
    "DELETE FROM notifications; DELETE FROM notification_events; DELETE FROM notification_subscriptions;",
  );
  now = T0;
  mem = memoryChannel("telegram");
  cfg = {
    enabled: true,
    workerSecret: WORKER,
    push: {
      publicKey: "PUB",
      privateKey: "PRIV",
      subject: "mailto:ops@aroma.example",
    },
    telegram: { token: "1:x", bot: "aroma_bot", webhookSecret: HOOK },
    sinkUrl: null,
  };
  const store = memoryStore();
  setNotifyDepsForTests({
    config: () => cfg,
    db: () => db,
    challenges: () => store,
    channels: () => ({ telegram: mem }),
    scan: async () => ({ symbolOf: () => null, basketNameOf: () => null }),
    site: () => SITE,
    now: () => now,
  });
});

type Signer = Awaited<ReturnType<typeof makeSigner>>;
async function signed(signer: Signer, body: Record<string, unknown>) {
  const res = await challenge.POST(
    req("/api/v1/notifications/challenge", { wallet: signer.wallet, ...body }),
  );
  expect(res.status).toBe(200);
  const c = (await res.json()) as { nonce: string; message: string };
  return {
    nonce: c.nonce,
    signature: await signer.sign(c.message),
    message: c.message,
  };
}
async function telegramOptIn(signer: Signer, events = ["trade_confirmed"]) {
  const s = await signed(signer, {
    purpose: "notify-subscribe",
    channel: "telegram",
    events,
  });
  const res = await subs.POST(
    req("/api/v1/notifications/subscriptions", {
      wallet: signer.wallet,
      nonce: s.nonce,
      signature: s.signature,
      channel: "telegram",
      events,
    }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { telegramLink: string; token: string };
  return {
    ...body,
    code: new URL(body.telegramLink).searchParams.get("start")!,
  };
}
const hook = (text: string, secret = HOOK, chatId = 777) =>
  telegram.POST(
    req(
      "/api/v1/notifications/telegram",
      {
        update_id: 1,
        message: { chat: { id: chatId, type: "private" }, text },
      },
      {
        "x-telegram-bot-api-secret-token": secret,
      },
    ),
  );

describe("config", () => {
  it("exposes only the VAPID public key and the bot's username", async () => {
    const body = await (
      await config.GET(get("/api/v1/notifications/config"))
    ).json();
    expect(body).toEqual({
      enabled: true,
      push: { publicKey: "PUB" },
      telegram: { bot: "aroma_bot" },
    });
    expect(JSON.stringify(body)).not.toMatch(/PRIV|1:x|hhhh/);
  });
});

describe("opt-in and session", () => {
  it("a manage signature opens a session once; its replay is refused", async () => {
    const signer = await makeSigner();
    const s = await signed(signer, { purpose: "notify-manage" });
    const body = {
      wallet: signer.wallet,
      nonce: s.nonce,
      signature: s.signature,
    };
    expect(
      (await session.POST(req("/api/v1/notifications/session", body))).status,
    ).toBe(200);
    const replay = await session.POST(
      req("/api/v1/notifications/session", body),
    );
    expect(replay.status).toBe(401);
    expect(await replay.json()).toEqual({
      code: "UNAUTHORIZED",
      message: expect.any(String),
    });
  });

  it("an opt-in signed for other events (or by another wallet) is refused", async () => {
    const signer = await makeSigner();
    const s = await signed(signer, {
      purpose: "notify-subscribe",
      channel: "telegram",
      events: ["trade_failed"],
    });
    const res = await subs.POST(
      req("/api/v1/notifications/subscriptions", {
        wallet: signer.wallet,
        nonce: s.nonce,
        signature: s.signature,
        channel: "telegram",
        events: ["trade_confirmed"],
      }),
    );
    expect(res.status).toBe(401);
  });

  it("push: an endpoint outside the push services is refused before any signature", async () => {
    const signer = await makeSigner();
    const res = await challenge.POST(
      req("/api/v1/notifications/challenge", {
        purpose: "notify-subscribe",
        wallet: signer.wallet,
        channel: "push",
        events: ["trade_confirmed"],
        endpoint: "https://169.254.169.254/latest",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("with notifications off, opt-ins are refused (503)", async () => {
    cfg = { ...cfg, enabled: false };
    const signer = await makeSigner();
    const res = await challenge.POST(
      req("/api/v1/notifications/challenge", {
        purpose: "notify-manage",
        wallet: signer.wallet,
      }),
    );
    expect(res.status).toBe(503);
  });

  it("session routes refuse a missing or foreign token", async () => {
    expect(
      (await subs.GET(get("/api/v1/notifications/subscriptions"))).status,
    ).toBe(401);
    const res = await testRoute.POST(
      req(
        "/api/v1/notifications/test",
        { channel: "telegram" },
        { authorization: "Bearer ws1.creator.x.y.z" },
      ),
    );
    expect(res.status).toBe(401);
  });

  it("an oversized body is refused (413)", async () => {
    const res = await session.POST(
      req("/api/v1/notifications/session", { pad: "x".repeat(5_000) }),
    );
    expect(res.status).toBe(413);
  });
});

describe("Telegram verification", () => {
  it("the webhook needs its secret; /start <code> verifies once; the address is never returned", async () => {
    const signer = await makeSigner();
    const { code, token } = await telegramOptIn(signer);
    expect((await hook(`/start ${code}`, "wrong".padEnd(40, "x"))).status).toBe(
      401,
    );
    expect((await hook(`/start ${code}`)).status).toBe(200);
    const list = await (
      await subs.GET(
        get("/api/v1/notifications/subscriptions", {
          authorization: `Bearer ${token}`,
        }),
      )
    ).json();
    expect(list.subscriptions).toEqual([
      expect.objectContaining({ channel: "telegram", status: "active" }),
    ]);
    expect(JSON.stringify(list)).not.toContain("777");
    // The code is single use: a second chat cannot take the link over.
    await hook(`/start ${code}`, HOOK, 888);
    const { rows } = await client.query<{ address: { chatId: number } }>(
      "SELECT address FROM notification_subscriptions",
    );
    expect(rows).toEqual([{ address: { chatId: 777 } }]);
  });

  it("/stop deletes the link (hard delete)", async () => {
    const signer = await makeSigner();
    const { code } = await telegramOptIn(signer);
    await hook(`/start ${code}`);
    await hook("/stop");
    expect(
      (await client.query("SELECT 1 FROM notification_subscriptions")).rows,
    ).toHaveLength(0);
  });
});

describe("test send, worker and deletes", () => {
  async function linked() {
    const signer = await makeSigner();
    const { code, token } = await telegramOptIn(signer);
    await hook(`/start ${code}`);
    return { signer, auth: { authorization: `Bearer ${token}` } };
  }
  const run = (secret = WORKER) =>
    deliver.POST(
      req(
        "/api/v1/notifications/deliver",
        {},
        { authorization: `Bearer ${secret}` },
      ),
    );

  it("a test reaches only the wallet's own channel, once; a second within a minute is 429", async () => {
    const { auth } = await linked();
    expect(
      (
        await testRoute.POST(
          req("/api/v1/notifications/test", { channel: "telegram" }, auth),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await testRoute.POST(
          req("/api/v1/notifications/test", { channel: "telegram" }, auth),
        )
      ).status,
    ).toBe(429);
    expect((await run("x".repeat(40))).status).toBe(401);
    const report = await (await run()).json();
    expect(report).toMatchObject({ paused: false, sent: 1 });
    await run();
    expect(mem.sent.map((d) => d.message.title)).toEqual([
      "Test notification from Aroma",
    ]);
    expect(mem.sent[0]?.address).toEqual({ chatId: 777 });
  });

  it("with notifications off the worker sends nothing", async () => {
    const { auth } = await linked();
    await testRoute.POST(
      req("/api/v1/notifications/test", { channel: "telegram" }, auth),
    );
    cfg = { ...cfg, enabled: false };
    expect(await (await run()).json()).toEqual({ paused: true });
    expect(mem.sent).toHaveLength(0);
  });

  it("event choices change per channel; turning a channel off deletes it and its deliveries", async () => {
    const { auth } = await linked();
    const update = await channelRoute.POST(
      req(
        "/api/v1/notifications/subscriptions/telegram",
        { channel: "telegram", events: ["trade_failed"] },
        auth,
      ),
      params("telegram"),
    );
    expect((await update.json()).subscription.events).toEqual(["trade_failed"]);
    await testRoute.POST(
      req("/api/v1/notifications/test", { channel: "telegram" }, auth),
    );
    await run();
    const off = await channelRoute.DELETE(
      req("/api/v1/notifications/subscriptions/telegram", {}, auth, "DELETE"),
      params("telegram"),
    );
    expect(off.status).toBe(200);
    expect(
      (await client.query("SELECT 1 FROM notification_subscriptions")).rows,
    ).toHaveLength(0);
    expect(
      (await client.query("SELECT 1 FROM notifications")).rows,
    ).toHaveLength(0);
  });

  it("delete all removes subscriptions, deliveries and events of this wallet only", async () => {
    const a = await linked();
    const b = await linked();
    await testRoute.POST(
      req("/api/v1/notifications/test", { channel: "telegram" }, a.auth),
    );
    await testRoute.POST(
      req("/api/v1/notifications/test", { channel: "telegram" }, b.auth),
    );
    const res = await subs.DELETE(
      req("/api/v1/notifications/subscriptions", {}, a.auth, "DELETE"),
    );
    expect(res.status).toBe(200);
    const left = await client.query<{ wallet: string }>(
      "SELECT wallet FROM notification_subscriptions UNION ALL SELECT wallet FROM notification_events",
    );
    expect(new Set(left.rows.map((r) => r.wallet))).toEqual(
      new Set([b.signer.wallet]),
    );
  });
});
