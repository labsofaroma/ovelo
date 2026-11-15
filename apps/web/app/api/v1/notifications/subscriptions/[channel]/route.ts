import { z } from "zod";
import {
  BETA_CHANNELS,
  preferencesBodySchema,
} from "@/features/notifications/schema";
import { notifyDeps } from "@/features/notifications/server/deps";
import { noStore, notifyRoute } from "@/features/notifications/server/http";
import {
  deleteChannel,
  sessionWallet,
  updateEvents,
} from "@/features/notifications/server/service";
import { AppError } from "@/server/errors";
import { assertSameOrigin, parse } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ channel: string }> };
const channelOf = async ({ params }: Params) => {
  const parsed = z.enum(BETA_CHANNELS).safeParse((await params).channel);
  if (!parsed.success) throw new AppError("NOT_FOUND", { detail: "channel" });
  return parsed.data;
};

/** POST (session) { channel, events }: which events this channel receives. */
export const POST = notifyRoute(
  "v1/notifications/subscriptions/[channel]",
  async (request, context: Params) => {
    assertSameOrigin(request);
    const deps = notifyDeps();
    const wallet = sessionWallet(deps, request);
    const channel = await channelOf(context);
    const body = await parse(preferencesBodySchema, { maxBytes: 1_024 })(
      request,
    );
    if (body.channel !== channel)
      throw new AppError("VALIDATION_FAILED", { detail: "channel mismatch" });
    return Response.json(await updateEvents(deps, wallet, body), {
      headers: noStore,
    });
  },
);

/** DELETE (session) {}: turn the channel off; its address and deliveries are deleted. */
export const DELETE = notifyRoute(
  "v1/notifications/subscriptions/[channel]",
  async (request, context: Params) => {
    assertSameOrigin(request);
    const deps = notifyDeps();
    const wallet = sessionWallet(deps, request);
    const channel = await channelOf(context);
    await parse(z.strictObject({}), { maxBytes: 256 })(request);
    return Response.json(await deleteChannel(deps, wallet, channel), {
      headers: noStore,
    });
  },
);
