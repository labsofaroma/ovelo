import { revalidateTag } from "next/cache";
import { assertRevalidateAuthorized, revalidateBodySchema } from "@/features/shared/revalidate";
import { isV1Enabled, tryGetEnv } from "@/server/env";
import { AppError } from "@/server/errors";
import { errorResponse, parse } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/v1/revalidate  `Authorization: Bearer <AROMA_REVALIDATE_SECRET>`
 * Body: `{ "tags": ["v1:markets", "v1:research:<mint>"] }`. Marks cached v1 data stale so the
 * next request refetches (Next data cache, `revalidateTag`). For operators and a future QStash
 * job; pages already refresh themselves on their `revalidate` interval.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    if (!isV1Enabled()) throw new AppError("NOT_FOUND");
    const env = tryGetEnv();
    assertRevalidateAuthorized(
      request.headers.get("authorization"),
      env.ok ? env.env.server.AROMA_REVALIDATE_SECRET : undefined,
    );
    const { tags } = await parse(revalidateBodySchema, { maxBytes: 4_096 })(request);
    for (const tag of tags) revalidateTag(tag);
    return Response.json({ revalidated: tags }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, { route: "v1/revalidate" });
  }
}
