import { notifyDeps } from "@/features/notifications/server/deps";
import { publicNotifyConfig } from "@/features/notifications/server/config";
import { noStore, notifyRoute } from "@/features/notifications/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/notifications/config → which channels exist here, the VAPID public key, the bot. */
export const GET = notifyRoute("v1/notifications/config", async () =>
  Response.json(publicNotifyConfig(notifyDeps().config()), {
    headers: noStore,
  }),
);
