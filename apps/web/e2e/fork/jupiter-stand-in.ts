import { createServer } from "node:http";

/** Serves the Jupiter `/swap/v2/build` routes recorded by e2e/fork/run.ts, on loopback only. */
export function startJupiterStandIn(
  routes: Record<string, unknown>,
  port: number,
) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    const route =
      routes[
        `${url.searchParams.get("outputMint")}:${url.searchParams.get("amount")}`
      ];
    response.setHeader("content-type", "application/json");
    if (url.pathname !== "/swap/v2/build" || !route) {
      response.statusCode = 400;
      response.end(JSON.stringify({ errorCode: "NO_ROUTES_FOUND" }));
      return;
    }
    response.end(JSON.stringify(route));
  });
  server.listen(port, "127.0.0.1");
  return server;
}
