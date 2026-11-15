import { randomBytes, randomInt } from "node:crypto";
import { createServer, type Server } from "node:http";

/**
 * M11 E2E: a loopback stand-in for every notification channel. The app (test switches only,
 * AROMA_V1_TEST_NOTIFY_SINK_URL) posts each delivery here instead of to a push service or
 * Telegram; the spec reads them back with GET. Nothing leaves 127.0.0.1.
 */
export const NOTIFY_SINK_PORT = 4040;
export const NOTIFY_SINK_URL = `http://127.0.0.1:${NOTIFY_SINK_PORT}/sink`;

/**
 * Test-only notification settings, generated for this run (never committed). The Telegram values
 * are throwaway: the sink receives every delivery and bot reply, nothing goes to Telegram.
 */
export const NOTIFY_E2E_ENV = {
  AROMA_V1_TEST_NOTIFY_SINK_URL: NOTIFY_SINK_URL,
  AROMA_NOTIFY_WORKER_SECRET: randomBytes(24).toString("base64url"),
  TELEGRAM_BOT_TOKEN: `${randomInt(100_000, 999_999)}:${randomBytes(27).toString("base64url")}`,
  TELEGRAM_BOT_USERNAME: "aroma_e2e_bot",
  TELEGRAM_WEBHOOK_SECRET: randomBytes(24).toString("base64url"),
};

export function startNotifySink(port = NOTIFY_SINK_PORT): Server {
  const received: unknown[] = [];
  const server = createServer((req, res) => {
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(received));
      return;
    }
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
      if (body.length > 65_536) req.destroy();
    });
    req.on("end", () => {
      try {
        received.push(JSON.parse(body));
      } catch {
        // ignore malformed bodies
      }
      res.writeHead(204);
      res.end();
    });
  });
  server.listen(port, "127.0.0.1");
  return server;
}
