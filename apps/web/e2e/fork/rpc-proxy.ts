import { createServer, type IncomingMessage, type Server } from "node:http";

/**
 * M9 failover E2E: two loopback JSON-RPC proxies in front of the ONE local fork validator, so the
 * app sees a primary and a fallback endpoint on the same cluster. A control server switches each
 * proxy's mode while the specs run (e2e/trade/failover.spec.ts). Nothing here reaches mainnet.
 *
 *   forward        pass every request to the validator
 *   down           drop every request without an answer (a transport failure)
 *   wrong-genesis  answer getGenesisHash with another cluster's genesis, forward the rest
 *   swallow-send   forward sendTransaction, then drop the response (sent, but the caller cannot
 *                  know); forward the rest
 */
export type ProxyMode = "forward" | "down" | "wrong-genesis" | "swallow-send";
export type ProxyName = "primary" | "fallback";
export const RPC_PROXY_PORTS = {
  control: 18900,
  primary: 18901,
  fallback: 18902,
};
const MODES: readonly ProxyMode[] = [
  "forward",
  "down",
  "wrong-genesis",
  "swallow-send",
];

const body = (request: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let text = "";
    request.on("data", (chunk) => (text += chunk));
    request.on("end", () => resolve(text));
    request.on("error", reject);
  });

export function startRpcProxies(
  target: string,
  otherGenesis: string,
): { close: () => void } {
  const modes: Record<ProxyName, ProxyMode> = {
    primary: "forward",
    fallback: "forward",
  };
  // sendTransaction requests each proxy received (GET / on the control server reports them).
  const sends: Record<ProxyName, number> = { primary: 0, fallback: 0 };
  const servers: Server[] = [];
  for (const name of ["primary", "fallback"] as const) {
    const server = createServer(async (request, response) => {
      const text = await body(request);
      const mode = modes[name];
      const method = (() => {
        try {
          return (JSON.parse(text) as { method?: string }).method;
        } catch {
          return undefined;
        }
      })();
      if (method === "sendTransaction") sends[name] += 1;
      if (mode === "down") return request.socket.destroy();
      if (mode === "wrong-genesis" && method === "getGenesisHash") {
        response.setHeader("content-type", "application/json");
        return response.end(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: otherGenesis }),
        );
      }
      const upstream = await fetch(target, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: text,
      }).catch(() => null);
      if (!upstream) return request.socket.destroy();
      const answer = await upstream.text();
      if (mode === "swallow-send" && method === "sendTransaction")
        return request.socket.destroy();
      response.statusCode = upstream.status;
      response.setHeader("content-type", "application/json");
      response.end(answer);
    });
    server.listen(RPC_PROXY_PORTS[name], "127.0.0.1");
    servers.push(server);
  }
  const control = createServer((request, response) => {
    // POST /<primary|fallback>/<mode>; GET / returns the modes.
    const [, name, mode] = (request.url ?? "/").split("/") as [
      string,
      ProxyName,
      ProxyMode,
    ];
    if (request.method === "POST" && name in modes && MODES.includes(mode))
      modes[name] = mode;
    else if (request.method === "POST") response.statusCode = 400;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ modes, sends }));
  });
  control.listen(RPC_PROXY_PORTS.control, "127.0.0.1");
  servers.push(control);
  return { close: () => servers.forEach((s) => s.close()) };
}

export const proxyUrl = (name: ProxyName) =>
  `http://127.0.0.1:${RPC_PROXY_PORTS[name]}`;
export const controlUrl = `http://127.0.0.1:${RPC_PROXY_PORTS.control}`;
