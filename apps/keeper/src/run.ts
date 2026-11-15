import {
  createKeyPairSignerFromBytes,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";
import {
  decodeConfigAccount,
  decodePlanAccount,
  diffPlanIndex,
  findConfigPda,
  indexRowFromPlan,
  planAccountFilters,
  V1_PROGRAM_ID,
} from "@ovelo/guard";
import {
  HermesUpdatesClient,
  type HermesLatestUpdates,
} from "@ovelo/guard/pyth";
import { sendAlert, type AlertDeps } from "./alerts";
import type { KeeperDb } from "./db";
import type { KeeperEnv } from "./env";
import { executePlan, type Outcome } from "./execute";
import type { Logger } from "./log";
import { connectRpc, type KeeperRpc } from "./rpc";
import { isMainnetCluster } from "./mainnet/env";
import {
  assertMainnetKeeper,
  executeMode,
  type ExecuteMode,
} from "./mainnet/wiring";
import { deadLetterCount, DLQ_SEEN_KEY, type KeeperRedis } from "./store";

/**
 * One keeper run (POST /run): stateless, everything comes from the chain, Postgres and Redis.
 * 1. RPC (genesis check, latency) and the keeper's SOL balance; 2. the config (the keeper must be
 * `keeper_authority`); 3. reconcile plans_index from chain (the reconcile job); 4. due plans,
 * oldest due first, each confirmed on chain; 5. dead-letter growth.
 */

export const RPC_DEGRADED_MS = 3_000;

export type RunDeps = {
  env: KeeperEnv;
  db: KeeperDb;
  redis: KeeperRedis;
  log: Logger;
  alerts: Omit<AlertDeps, "redis" | "log">;
  transport?: Parameters<typeof connectRpc>[1];
  hermes?: {
    latestUpdates(ids: readonly string[]): Promise<HermesLatestUpdates>;
  };
  sleep?: (ms: number) => Promise<void>;
  /** Mainnet mode (M8); tests inject it, production derives it from the environment. */
  mode?: ExecuteMode;
};

export type RunReport = {
  cluster: string;
  chainTime: string;
  reconciled: { drift: number };
  outcomes: Outcome[];
  deadLetters: number;
  alerts: number;
};

/** The devnet key on devnet/localnet, the separate mainnet key in the mainnet modes (M8). */
export async function keeperSigner(
  env: Pick<
    KeeperEnv,
    "KEEPER_CLUSTER" | "KEEPER_KEYPAIR" | "KEEPER_MAINNET_KEYPAIR"
  >,
): Promise<KeyPairSigner> {
  const secret = isMainnetCluster(env.KEEPER_CLUSTER)
    ? env.KEEPER_MAINNET_KEYPAIR
    : env.KEEPER_KEYPAIR;
  if (!secret) throw new Error("No keeper key for this cluster");
  return createKeyPairSignerFromBytes(
    Uint8Array.from(JSON.parse(secret) as number[]),
  );
}

async function chainNow(rpc: KeeperRpc): Promise<bigint> {
  const slot = await rpc.getSlot({ commitment: "confirmed" }).send();
  const time = await rpc.getBlockTime(slot).send();
  if (time === null) throw new Error("block time unavailable");
  return BigInt(time);
}

/** The reconcile job: every v1 plan on chain mirrored into plans_index; drift logged. */
export async function reconcile(
  rpc: KeeperRpc,
  db: KeeperDb,
  log: Logger,
  now: bigint,
): Promise<{ drift: number }> {
  const accounts = await rpc
    .getProgramAccounts(V1_PROGRAM_ID, {
      encoding: "base64",
      commitment: "confirmed",
      filters: planAccountFilters(),
    })
    .send();
  const chain = accounts.flatMap((a) => {
    try {
      return [
        indexRowFromPlan(
          a.pubkey,
          decodePlanAccount(
            Uint8Array.from(Buffer.from(a.account.data[0], "base64")),
          ),
          now,
        ),
      ];
    } catch {
      return [];
    }
  });
  const { upserts, closes, drift } = diffPlanIndex(chain, await db.allRows());
  if (upserts.length) await db.upsertRows(upserts);
  if (closes.length) await db.closeRows(closes);
  for (const item of drift)
    log.warn(
      { pda: item.pda, kind: item.kind, fields: item.fields },
      "plans_index drift repaired",
    );
  return { drift: drift.length };
}

export async function runOnce(deps: RunDeps): Promise<RunReport> {
  const { env, log } = deps;
  let alertsSent = 0;
  const alerts: AlertDeps = { ...deps.alerts, redis: deps.redis, log };
  const alert = async (a: Parameters<typeof sendAlert>[1]) => {
    if ((await sendAlert(alerts, a)) !== "deduplicated") alertsSent += 1;
  };
  let connected: Awaited<ReturnType<typeof connectRpc>>;
  try {
    connected = await connectRpc(env, deps.transport);
  } catch (error) {
    await alert({
      kind: "rpc_degraded",
      subject: "connect",
      title: "Keeper RPC unreachable or on the wrong cluster",
      details: {
        error: String(error instanceof Error ? error.message : error),
      },
    });
    throw error;
  }
  const { rpc, latencyMs } = connected;
  if (latencyMs > RPC_DEGRADED_MS)
    await alert({
      kind: "rpc_degraded",
      subject: "latency",
      title: "Keeper RPC is slow",
      details: { latencyMs: String(latencyMs) },
    });
  const keeper = await keeperSigner(env);
  const balance = await rpc
    .getBalance(keeper.address, { commitment: "confirmed" })
    .send();
  if (balance.value < BigInt(env.KEEPER_MIN_SOL_LAMPORTS))
    await alert({
      kind: "keeper_balance_low",
      subject: keeper.address,
      title: "Keeper SOL balance is low",
      details: {
        lamports: balance.value.toString(),
        minimum: String(env.KEEPER_MIN_SOL_LAMPORTS),
        keeper: keeper.address,
      },
    });
  const { value: configAccount } = await rpc
    .getAccountInfo(await findConfigPda(), {
      encoding: "base64",
      commitment: "confirmed",
    })
    .send();
  if (!configAccount)
    throw new Error("Ovelo Guard v1 config is missing on this cluster");
  const config = decodeConfigAccount(
    Uint8Array.from(Buffer.from(configAccount.data[0], "base64")),
  );
  if (
    config.keeperAuthority.__option === "Some" &&
    config.keeperAuthority.value !== keeper.address
  )
    throw new Error(
      "This key is not the configured keeper_authority; refusing to run",
    );
  assertMainnetKeeper(env.KEEPER_CLUSTER, config);
  const mode = deps.mode ?? executeMode(env);
  const now = await chainNow(rpc);
  const reconciled = await reconcile(rpc, deps.db, log, now);
  const due = await deps.db.dueRows(
    new Date(Number(now) * 1000),
    env.KEEPER_MAX_PLANS_PER_RUN,
  );
  const hermes =
    deps.hermes ??
    new HermesUpdatesClient(env.HERMES_URL, { apiKey: env.PYTH_API_KEY });
  const outcomes: Outcome[] = [];
  for (const row of due) {
    try {
      outcomes.push(
        await executePlan(
          {
            rpc,
            keeper,
            db: deps.db,
            redis: deps.redis,
            log,
            alerts,
            hermes,
            config,
            notifyDevnet: !isMainnetCluster(env.KEEPER_CLUSTER),
            ...mode,
            send: {
              priorityMicroLamports: BigInt(env.KEEPER_PRIORITY_MICROLAMPORTS),
              maxAttempts: env.KEEPER_MAX_ATTEMPTS,
              sleep: deps.sleep,
            },
          },
          row.pda as Address,
          decodePlanAccount,
          now,
        ),
      );
    } catch (error) {
      log.error(
        { err: error, plan: row.pda },
        "plan run failed before execution",
      );
    }
  }
  const deadLetters = await deadLetterCount(deps.redis);
  const seen = Number((await deps.redis.get(DLQ_SEEN_KEY)) ?? 0);
  if (deadLetters >= env.KEEPER_DLQ_ALERT_THRESHOLD && deadLetters > seen)
    await alert({
      kind: "dead_letter_growth",
      subject: String(deadLetters),
      title: `Dead-letter list grew to ${deadLetters}`,
      details: { previous: String(seen), now: String(deadLetters) },
    });
  await deps.redis.set(DLQ_SEEN_KEY, String(deadLetters));
  log.info(
    {
      outcomes: outcomes.map((o) => [o.plan, o.status, o.period]),
      drift: reconciled.drift,
      deadLetters,
    },
    "keeper run finished",
  );
  return {
    cluster: env.KEEPER_CLUSTER,
    chainTime: now.toString(),
    reconciled,
    outcomes,
    deadLetters,
    alerts: alertsSent,
  };
}
