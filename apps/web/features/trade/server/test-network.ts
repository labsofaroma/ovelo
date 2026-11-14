import { vi } from "vitest";

/** Test helper: a fake mainnet JSON-RPC network for the failover tests (no network, no keys). */
export type Behaviour =
  | "ok"
  | "transport"
  | "timeout"
  | "http500"
  | "http503"
  | "http429"
  | "http401-html"
  | "rpc-error";

/** A fake JSON-RPC network: each URL has a genesis and a behaviour per call. */
export function network(
  nodes: Record<
    string,
    {
      genesis: string;
      behave: (method: string) => Behaviour;
      /** The result for an "ok" call (default: "<url>:<method>"). */
      answer?: (method: string, params: unknown) => unknown;
    }
  >,
) {
  const log: {
    url: string;
    method: string;
    params: unknown;
    outcome?: Behaviour | "unknown-host";
  }[] = [];
  const fetch = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      const { method, params } = JSON.parse(String(init?.body)) as {
        method: string;
        params: unknown;
      };
      const node = nodes[String(url)];
      const entry: (typeof log)[number] = { url: String(url), method, params };
      log.push(entry);
      if (!node) {
        entry.outcome = "unknown-host";
        throw new TypeError("unknown host");
      }
      const behaviour = node.behave(method);
      entry.outcome = behaviour;
      if (behaviour === "transport") throw new TypeError("fetch failed");
      if (behaviour === "timeout")
        throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
      if (behaviour === "http500") return new Response("oops", { status: 500 });
      if (behaviour === "http503") return Response.json({}, { status: 503 });
      if (behaviour === "http429")
        return Response.json(
          { jsonrpc: "2.0", id: 1, error: { code: 429, message: "slow down" } },
          { status: 429 },
        );
      if (behaviour === "http401-html")
        return new Response("<html>401</html>", { status: 401 });
      if (behaviour === "rpc-error")
        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32002, message: "Transaction simulation failed" },
        });
      return Response.json({
        jsonrpc: "2.0",
        id: 1,
        result:
          method === "getGenesisHash"
            ? node.genesis
            : node.answer
              ? node.answer(method, params)
              : `${String(url)}:${method}`,
      });
    },
  );
  return { fetch: fetch as unknown as typeof globalThis.fetch, log };
}
