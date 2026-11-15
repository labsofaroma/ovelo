import { createServer } from "node:http";
import { parseKeeperEnv } from "./env";
import { createHandler } from "./handler";
import { createLogger } from "./log";
import { connectRpc } from "./rpc";
import { keeperSigner, runOnce } from "./run";
import { runDeps } from "./services";

/**
 * `pnpm --filter @ovelo/keeper start`. Boot: validate env, check the RPC's genesis (devnet, or the
 * configured local validator) BEFORE listening, then serve POST /run and GET /health. Exits 1 on a
 * wrong cluster or an invalid environment; the keeper key is never printed.
 */
async function main() {
  const env = parseKeeperEnv(process.env);
  const log = createLogger(env.LOG_LEVEL);
  await connectRpc(env);
  const keeper = await keeperSigner(env);
  const deps = runDeps(env, log);
  const handler = createHandler({
    log,
    cluster: env.KEEPER_CLUSTER,
    currentKey: env.QSTASH_CURRENT_SIGNING_KEY,
    nextKey: env.QSTASH_NEXT_SIGNING_KEY,
    publicUrl: env.KEEPER_PUBLIC_URL,
    run: () => runOnce(deps),
  });
  createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > 64 * 1024) {
        res.writeHead(413).end();
        return;
      }
      chunks.push(chunk as Buffer);
    }
    const request = new Request(
      `http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`,
      {
        method: req.method,
        headers: Object.entries(req.headers).flatMap(([k, v]) =>
          typeof v === "string" ? [[k, v] as [string, string]] : [],
        ),
        body:
          req.method === "GET" || req.method === "HEAD"
            ? undefined
            : Buffer.concat(chunks),
      },
    );
    const response = await handler(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  }).listen(env.KEEPER_PORT, "0.0.0.0", () =>
    log.info(
      {
        port: env.KEEPER_PORT,
        cluster: env.KEEPER_CLUSTER,
        keeper: keeper.address,
      },
      "keeper listening",
    ),
  );
}

main().catch((error: Error) => {
  process.stderr.write(`${error.name}: ${error.message}\n`);
  process.exit(1);
});
