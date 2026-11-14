import { productionServices } from "@/features/invest/server/deps";
import { investHandlers } from "@/features/invest/server/routes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/v1/faucet (devnet only): a wallet-signed claim plus a Cloudflare Turnstile token;
 * Redis limits per wallet and per IP and a daily budget. Sends a small, fixed amount of test USD
 * and a small SOL top-up.
 */
export async function POST(request: Request): Promise<Response> {
  return investHandlers(productionServices).faucet(request);
}
