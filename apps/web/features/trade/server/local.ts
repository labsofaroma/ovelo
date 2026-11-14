import "server-only";
import { testSwitchesAllowed } from "@/server/env.schema";
import { mainnetEndpoint } from "./rpc";

/**
 * A local-fork E2E run (test switches + a fork genesis on a loopback RPC): no Redis exists there,
 * so the trade store and creator challenges use in-process stores. Never true in production:
 * the env schema refuses the test switches when VERCEL_ENV=production.
 */
export function localStores(): boolean {
  return mainnetEndpoint().fork && testSwitchesAllowed(process.env);
}
