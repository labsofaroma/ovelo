import "server-only";
import type { Address } from "@solana/kit";
import type { TradeKeyring } from "@/server/auth/trade";
import {
  assertSameOrigin,
  errorResponse,
  parse,
  parseValue,
} from "@/server/http";
import type { LeaseRedis } from "@/server/lease";
import {
  base58Address,
  faucetSchema,
  prepareCloseSchema,
  prepareCreateSchema,
  submitSchema,
} from "../schema";
import type { BasketSource } from "./catalog";
import type { InvestNetwork, InvestRpc } from "./cluster";
import { claimTestTokens } from "./faucet";
import type { FaucetRedis } from "./faucet-limits";
import { listPlans } from "./plans";
import { prepareClose, prepareCreate } from "./prepare";
import type { InvestStore } from "./store";
import { submitPlan } from "./submit";

/**
 * `/api/v1/plans/*` and `/api/v1/faucet` handlers (B3, B6). Shape (REWRITE-PLAN §5.4):
 * flag gate → origin check (POST) → `parse(schema)` → service → typed JSON, or `{ code, message }`
 * through mapError. Middleware adds the Origin allowlist and the trade/faucet rate buckets.
 */

export type InvestServices = {
  /** The cluster and a genesis-verified RPC client, or INVEST_UNAVAILABLE. */
  context(): Promise<{ network: InvestNetwork; rpc: InvestRpc }>;
  keyring(): TradeKeyring;
  store(): InvestStore;
  redis(): LeaseRedis & FaucetRedis;
  baskets(): Promise<BasketSource[]>;
  faucet(): { key: Uint8Array; turnstileSecret: string; dailyClaims: number };
  clientIp(request: Request): string;
};

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

function gate(request: Request, post: boolean): void {
  if (post) assertSameOrigin(request);
}

export function investHandlers(services: InvestServices) {
  return {
    async prepareCreate(request: Request): Promise<Response> {
      try {
        gate(request, true);
        const body = await parse(prepareCreateSchema)(request);
        const { network, rpc } = await services.context();
        return json(
          await prepareCreate(
            {
              network,
              rpc,
              keyring: services.keyring(),
              store: services.store(),
              baskets: () => services.baskets(),
            },
            body,
          ),
        );
      } catch (error) {
        return errorResponse(error, { route: "v1/plans/prepare-create" });
      }
    },

    async prepareClose(request: Request, pda: string): Promise<Response> {
      try {
        gate(request, true);
        const plan = parseValue(base58Address, pda) as Address;
        const body = await parse(prepareCloseSchema)(request);
        const { network, rpc } = await services.context();
        return json(
          await prepareClose(
            {
              network,
              rpc,
              keyring: services.keyring(),
              store: services.store(),
              baskets: () => services.baskets(),
            },
            plan,
            body.owner,
          ),
        );
      } catch (error) {
        return errorResponse(error, { route: "v1/plans/:pda/prepare-close" });
      }
    },

    async submit(request: Request): Promise<Response> {
      try {
        gate(request, true);
        const body = await parse(submitSchema)(request);
        const { network, rpc } = await services.context();
        return json(
          await submitPlan(
            {
              network,
              rpc,
              keyring: services.keyring(),
              store: services.store(),
              redis: services.redis(),
            },
            body,
          ),
        );
      } catch (error) {
        return errorResponse(error, { route: "v1/plans/submit" });
      }
    },

    async list(request: Request): Promise<Response> {
      try {
        gate(request, false);
        const owner = parseValue(
          base58Address,
          new URL(request.url).searchParams.get("owner"),
        );
        const { network, rpc } = await services.context();
        return json(
          await listPlans({ network, rpc, store: services.store() }, owner),
        );
      } catch (error) {
        return errorResponse(error, { route: "v1/plans" });
      }
    },

    async faucet(request: Request): Promise<Response> {
      try {
        gate(request, true);
        const body = await parse(faucetSchema)(request);
        const { network, rpc } = await services.context();
        const config = services.faucet();
        return json(
          await claimTestTokens(
            {
              network,
              rpc,
              redis: services.redis(),
              faucetKey: config.key,
              turnstileSecret: config.turnstileSecret,
              dailyClaims: config.dailyClaims,
              ip: services.clientIp(request),
            },
            body,
          ),
        );
      } catch (error) {
        return errorResponse(error, { route: "v1/faucet" });
      }
    },
  };
}
