import "server-only";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";

/**
 * Faucet limits in Redis (AUDIT H-5): one claim per wallet per 24 hours, at most three claims
 * per client IP per UTC day, and a global daily claim budget. Claims are taken atomically before
 * anything is sent, and released if the claim fails before tokens move.
 */

export type FaucetRedis = {
  set(
    key: string,
    value: string,
    options: { nx?: boolean; ex?: number },
  ): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
};

export const WALLET_COOLDOWN_SECONDS = 24 * 3600;
export const IP_CLAIMS_PER_DAY = 3;
export const DEFAULT_DAILY_CLAIMS = 200;

export const utcDay = (now: Date) =>
  now.toISOString().slice(0, 10).replaceAll("-", "");

export type FaucetClaim = { release(): Promise<void> };

export async function claimFaucet(
  redis: FaucetRedis,
  input: { wallet: string; ip: string; dailyClaims: number; now?: Date },
): Promise<FaucetClaim> {
  const day = utcDay(input.now ?? new Date());
  const walletKey = `faucet:wallet:${input.wallet}`;
  const ipKey = `faucet:ip:${input.ip}:${day}`;
  const dayKey = `faucet:day:${day}`;
  const taken: (() => Promise<unknown>)[] = [];
  const release = async () => {
    for (const undo of taken.reverse())
      await undo().catch((err: unknown) =>
        logger.error({ err }, "faucet limit release failed"),
      );
    taken.length = 0;
  };
  try {
    const walletFree = await redis.set(walletKey, "1", {
      nx: true,
      ex: WALLET_COOLDOWN_SECONDS,
    });
    if (walletFree !== "OK")
      throw new AppError("FAUCET_LIMITED", { detail: "wallet cooldown" });
    taken.push(() => redis.del(walletKey));
    const ipCount = await redis.incr(ipKey);
    taken.push(() => redis.decr(ipKey));
    if (ipCount === 1) await redis.expire(ipKey, 2 * 86_400);
    if (ipCount > IP_CLAIMS_PER_DAY)
      throw new AppError("FAUCET_LIMITED", { detail: "ip daily limit" });
    const dayCount = await redis.incr(dayKey);
    taken.push(() => redis.decr(dayKey));
    if (dayCount === 1) await redis.expire(dayKey, 2 * 86_400);
    if (dayCount > input.dailyClaims)
      throw new AppError("FAUCET_EXHAUSTED", {
        detail: `daily budget ${input.dailyClaims} reached`,
      });
  } catch (error) {
    await release();
    throw error;
  }
  return { release };
}
