import "server-only";
import { classifyRpcLag, type CheckStatus } from "@/server/health";
import { alertEvent } from "@/server/telemetry";
import { mainnetEndpoints, mainnetPool } from "./rpc";
import { callEndpoint, type RpcEndpoint } from "./rpc-pool";

/**
 * /api/v1/health for the server RPC (M9 failover): each endpoint proves its genesis on its own
 * and reports the age of a recently confirmed block (slot lag). The fallback is "skipped" when it
 * is not configured. Facts only: no URL, host or error text in the report.
 */
const PER_ENDPOINT_TIMEOUT_MS = 2_000;
const RANK: Record<CheckStatus, number> = {
  ok: 0,
  degraded: 1,
  fail: 2,
  skipped: 3,
};

type EndpointReport = {
  status: CheckStatus;
  slot?: number;
  lagSeconds?: number;
};

export async function probeEndpoint(
  endpoint: RpcEndpoint,
  options: { fetch?: typeof fetch; nowSeconds?: () => number } = {},
): Promise<EndpointReport> {
  const call = <T>(method: string, params: unknown[] = []) =>
    callEndpoint<T>(
      endpoint,
      method,
      params,
      options.fetch,
      PER_ENDPOINT_TIMEOUT_MS,
    );
  try {
    if ((await call<string>("getGenesisHash")) !== endpoint.genesis) {
      // Report a misconfigured endpoint now, not on the day the primary fails.
      alertEvent("rpc.wrong_cluster", { rpcEndpoint: endpoint.name });
      return { status: "fail" };
    }
    const slot = await call<number>("getSlot", [{ commitment: "confirmed" }]);
    // A slightly older slot: the tip's block time is often not available yet.
    const blockTime = await call<number | null>("getBlockTime", [slot - 4]);
    if (blockTime === null) return { status: "degraded", slot };
    const now = options.nowSeconds?.() ?? Date.now() / 1000;
    const lagSeconds = Math.max(0, Math.round(now - blockTime));
    return { status: classifyRpcLag(lagSeconds), slot, lagSeconds };
  } catch {
    return { status: "fail" };
  }
}

/**
 * One "rpc" check over both endpoints. Overall: the better endpoint's status, but never "ok"
 * while the other configured one is unhealthy (degraded: failover would be impaired).
 */
export function combineRpcReports(
  primary: EndpointReport,
  fallback: EndpointReport,
): CheckStatus {
  if (fallback.status === "skipped") return primary.status;
  const [best, other] =
    RANK[primary.status] <= RANK[fallback.status]
      ? [primary.status, fallback.status]
      : [fallback.status, primary.status];
  return best === "ok" && other !== "ok" ? "degraded" : best;
}

export async function rpcEndpointsProbe(
  options: { fetch?: typeof fetch; nowSeconds?: () => number } = {},
) {
  const endpoints = mainnetEndpoints();
  const fallbackEndpoint = endpoints.find((e) => e.name === "fallback");
  const [primary, fallback] = await Promise.all([
    probeEndpoint(endpoints[0]!, options),
    fallbackEndpoint
      ? probeEndpoint(fallbackEndpoint, options)
      : Promise.resolve<EndpointReport>({ status: "skipped" }),
  ]);
  return {
    status: combineRpcReports(primary, fallback),
    ...(primary.slot !== undefined ? { slot: primary.slot } : {}),
    ...(primary.lagSeconds !== undefined
      ? { lagSeconds: primary.lagSeconds }
      : {}),
    primary: primary.status,
    fallback: fallback.status,
    ...(fallback.slot !== undefined ? { fallbackSlot: fallback.slot } : {}),
    ...(fallback.lagSeconds !== undefined
      ? { fallbackLagSeconds: fallback.lagSeconds }
      : {}),
    // This instance's view: the primary is cooling down after a failure.
    fallbackInUse: mainnetPool().fallbackInUse(),
  };
}
