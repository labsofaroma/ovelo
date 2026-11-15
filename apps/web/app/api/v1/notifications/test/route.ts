import { testBodySchema } from "@/features/notifications/schema";
import { notifyDeps } from "@/features/notifications/server/deps";
import { noStore, notifyRoute } from "@/features/notifications/server/http";
import {
  sendTest,
  sessionWallet,
} from "@/features/notifications/server/service";
import { assertSameOrigin, parse } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST (session) { channel }: queue one test message to this wallet's own channel (1/min). */
export const POST = notifyRoute("v1/notifications/test", async (request) => {
  assertSameOrigin(request);
  const deps = notifyDeps();
  const wallet = sessionWallet(deps, request);
  const body = await parse(testBodySchema, { maxBytes: 256 })(request);
  return Response.json(await sendTest(deps, wallet, body.channel), {
    headers: noStore,
  });
});
