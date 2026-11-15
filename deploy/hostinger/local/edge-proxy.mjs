// Phase H Step 8: a LOCAL stand-in for Cloudflare's edge and the tunnel (test fixture only, never
// deployed; Node's http module, no dependency). It does what the real edge does to a request on
// its way to the origin:
//   - CF-Connecting-IP and CF-IPCountry are SET (overwritten) from where the client "is":
//     x-edge-client-ip / x-edge-client-country (test-only inputs, then removed), else the socket
//     address and DE. A client-sent CF-* value never survives, exactly as at Cloudflare.
//   - x-aroma-origin is SET to the origin secret (the Transform Rule), overwriting a client value.
//   - X-Forwarded-Proto and CF-Visitor = the scheme the client used at the edge (https in
//     production), and Host = the public hostname, as Cloudflare forwards them. In the fork E2E
//     the browser really is at http://127.0.0.1:<port>, so that mode keeps the client's own Host
//     and says http: the app's same-origin check compares exactly those with the Origin header.
//   - Everything else (a spoofed X-Forwarded-For, X-Real-IP, x-vercel-ip-country...) passes through
//     untouched, as Cloudflare passes it, so the spoofing suite proves the APP ignores it.
//
// Env: EDGE_UPSTREAM (http://app:3000), EDGE_PORT (8080), EDGE_HOST (public hostname; empty keeps
//      the client's Host), EDGE_SCHEME (https),
//      EDGE_ORIGIN_SECRET_FILE (a file holding the secret) or EDGE_ORIGIN_SECRET.
import { readFileSync } from "node:fs";
import http from "node:http";

const upstream = new URL(process.env.EDGE_UPSTREAM ?? "http://app:3000");
const port = Number(process.env.EDGE_PORT ?? 8080);
const host = process.env.EDGE_HOST ?? "beta.aroma.test";
const scheme = process.env.EDGE_SCHEME === "http" ? "http" : "https";
const secret = (
  process.env.EDGE_ORIGIN_SECRET_FILE
    ? readFileSync(process.env.EDGE_ORIGIN_SECRET_FILE, "utf8")
    : (process.env.EDGE_ORIGIN_SECRET ?? "")
).trim();
if (secret.length < 32) {
  process.stderr.write("edge-proxy: the origin secret is missing or short\n");
  process.exit(1);
}

const HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
]);

const server = http.createServer((req, res) => {
  const headers = {};
  for (const [name, value] of Object.entries(req.headers))
    if (!HOP.has(name) && value !== undefined) headers[name] = value;
  const clientIp =
    String(req.headers["x-edge-client-ip"] ?? "") ||
    (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
  const country = String(req.headers["x-edge-client-country"] ?? "DE");
  delete headers["x-edge-client-ip"];
  delete headers["x-edge-client-country"];
  Object.assign(headers, {
    host: host || req.headers.host || "localhost",
    "cf-connecting-ip": clientIp,
    "cf-ipcountry": country,
    "cf-visitor": JSON.stringify({ scheme }),
    "x-forwarded-proto": scheme,
    "x-aroma-origin": secret,
  });
  const out = http.request(
    {
      host: upstream.hostname,
      port: upstream.port || 80,
      method: req.method,
      path: req.url,
      headers,
    },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    },
  );
  out.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end("edge-proxy: origin unreachable");
  });
  req.pipe(out);
});
server.keepAliveTimeout = 5_000;
server.listen(port, "0.0.0.0", () =>
  process.stdout.write(
    `edge-proxy: :${port} -> ${upstream.origin} as ${scheme}://${host || "<client host>"}\n`,
  ),
);
process.once("SIGTERM", () => server.close(() => process.exit(0)));
