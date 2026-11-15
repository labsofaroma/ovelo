import {
  actionOptions,
  actionOrigin,
  actionRoute,
} from "@/features/baskets/action-http";
import {
  completedAction,
  recordActionPurchase,
} from "@/features/baskets/actions";
import { markActionPurchase } from "@/features/creators/channels";
import { receiptsReader } from "@/features/trade/server/deps";
import { mainnetRpc } from "@/features/trade/server/rpc";
import { keyringFromEnv } from "@/server/auth/trade";
import { readLimitedJson } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

/**
 * The Action's `links.next` callback (POST { account, signature }). State-changing, so it is
 * bound by the HMAC authorization in the query (AGENTS.md rule 2) AND by the transaction read
 * back from mainnet. Records the purchase receipt; returns a completed action.
 */
export const POST = actionRoute<Context>(
  "v1/actions/baskets/:id/confirm",
  async (request, context) => {
    const { status } = await recordActionPurchase(
      {
        basketId: (await context.params).id,
        authorization: new URL(request.url).searchParams.get("authorization"),
        body: await readLimitedJson(request, 1_024),
      },
      {
        keyring: keyringFromEnv(),
        rpc: mainnetRpc,
        receipts: receiptsReader(),
        now: Date.now,
        markAction: (signature) => markActionPurchase(signature),
      },
    );
    return Response.json(completedAction(actionOrigin(request), status));
  },
);

export const OPTIONS = actionOptions;
