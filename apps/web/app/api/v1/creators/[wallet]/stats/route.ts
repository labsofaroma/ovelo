import { creatorDeps, creatorRoute } from "@/features/creators/http";
import { getCreatorStats } from "@/features/creators/server";
import { walletSchema } from "@/server/auth/creator";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ wallet: string }> };

/**
 * GET /api/v1/creators/:wallet/stats → what Aroma records about a creator, with its source and
 * as-of time. Usage and volume are `unavailable` until purchase receipts exist (M5b), never 0.
 */
export const GET = creatorRoute<Context>(
  {
    route: "v1/creators/:wallet/stats",
    mutation: false,
  },
  async (_request, context) => {
    const wallet = walletSchema.safeParse((await context.params).wallet);
    if (!wallet.success)
      throw new AppError("NOT_FOUND", { detail: "bad wallet" });
    const deps = creatorDeps();
    const stats = await getCreatorStats(deps.db(), wallet.data, {
      now: deps.now(),
    });
    return Response.json(stats, {
      headers: { "Cache-Control": "public, max-age=0, s-maxage=30" },
    });
  },
);
