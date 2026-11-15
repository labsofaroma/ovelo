import {
  decodeConfigAccount,
  decodePlanAccount,
  findConfigPda,
} from "@ovelo/guard";
import { HermesUpdatesClient } from "@ovelo/guard/pyth";
import type { Address } from "@solana/kit";
import { parseKeeperEnv } from "./env";
import { executePlan } from "./execute";
import { createLogger } from "./log";
import { signQStashRequest } from "./qstash";
import { connectRpc } from "./rpc";
import { keeperSigner, reconcile } from "./run";
import { runDeps } from "./services";
import { listDeadLetters, removeDeadLetter } from "./store";

/**
 * Operator CLI (docs/keeper-operations.md):
 *   dlq list                     show dead-lettered items (newest first)
 *   dlq replay <id>|all          re-run the item's plan now; removed from the list on success
 *   dlq drop <id>                remove an item after handling it by hand
 *   run <url>                    a signed direct call to POST /run (current signing key)
 *   reconcile                    mirror every v1 plan on chain into plans_index
 */
async function main(argv: string[]) {
  const [command, sub, arg] = argv;
  const env = parseKeeperEnv(process.env);
  const log = createLogger(env.LOG_LEVEL);
  if (command === "run") {
    const url =
      sub ?? env.KEEPER_PUBLIC_URL ?? `http://127.0.0.1:${env.KEEPER_PORT}/run`;
    const body = JSON.stringify({ trigger: "cli" });
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Upstash-Signature": signQStashRequest({
          key: env.QSTASH_CURRENT_SIGNING_KEY,
          url,
          body,
        }),
      },
      body,
    });
    process.stdout.write(`${response.status} ${await response.text()}\n`);
    if (!response.ok) process.exitCode = 1;
    return;
  }
  const deps = runDeps(env, log);
  if (command === "dlq" && sub === "list") {
    process.stdout.write(
      `${JSON.stringify(
        (await listDeadLetters(deps.redis)).map((d) => d.entry),
        null,
        2,
      )}\n`,
    );
    return;
  }
  if (command === "dlq" && sub === "drop" && arg) {
    process.stdout.write(
      `${(await removeDeadLetter(deps.redis, arg)) ? "removed" : "not found"}\n`,
    );
    return;
  }
  const { rpc } = await connectRpc(env);
  if (command === "reconcile") {
    const slot = await rpc.getSlot().send();
    const now = BigInt(
      (await rpc.getBlockTime(slot).send()) ?? Math.floor(Date.now() / 1000),
    );
    process.stdout.write(
      `${JSON.stringify(await reconcile(rpc, deps.db, log, now))}\n`,
    );
    return;
  }
  if (command === "dlq" && sub === "replay" && arg) {
    const keeper = await keeperSigner(env);
    const items = (await listDeadLetters(deps.redis, 1_000)).filter(
      (d) => arg === "all" || d.entry.id === arg,
    );
    const { value } = await rpc
      .getAccountInfo(await findConfigPda(), { encoding: "base64" })
      .send();
    if (!value) throw new Error("config missing");
    const config = decodeConfigAccount(
      Uint8Array.from(Buffer.from(value.data[0], "base64")),
    );
    const hermes = new HermesUpdatesClient(env.HERMES_URL, {
      apiKey: env.PYTH_API_KEY,
    });
    for (const { entry } of items) {
      const slot = await rpc.getSlot().send();
      const now = BigInt(
        (await rpc.getBlockTime(slot).send()) ?? Math.floor(Date.now() / 1000),
      );
      const outcome = await executePlan(
        {
          rpc,
          keeper,
          db: deps.db,
          redis: deps.redis,
          log,
          alerts: { ...deps.alerts, redis: deps.redis, log },
          config,
          hermes,
          send: {
            priorityMicroLamports: BigInt(env.KEEPER_PRIORITY_MICROLAMPORTS),
            maxAttempts: env.KEEPER_MAX_ATTEMPTS,
          },
        },
        entry.plan as Address,
        decodePlanAccount,
        now,
      );
      if (outcome.status === "executed" || outcome.status === "not_due")
        await removeDeadLetter(deps.redis, entry.id);
      process.stdout.write(`${JSON.stringify({ id: entry.id, outcome })}\n`);
    }
    return;
  }
  process.stderr.write(
    "usage: cli dlq list | dlq replay <id|all> | dlq drop <id> | run [url] | reconcile\n",
  );
  process.exitCode = 2;
}

main(process.argv.slice(2)).catch((error: Error) => {
  process.stderr.write(`${error.name}: ${error.message}\n`);
  process.exit(1);
});
