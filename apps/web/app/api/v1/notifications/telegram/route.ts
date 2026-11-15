import { notifyDeps } from "@/features/notifications/server/deps";
import { noStore, notifyRoute } from "@/features/notifications/server/http";
import {
  assertTelegramSecret,
  handleTelegramUpdate,
} from "@/features/notifications/server/telegram-webhook";
import { readLimitedJson } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/v1/notifications/telegram: the bot's webhook. Authenticated by the webhook's secret
 * token header (bearer secret); handles `/start <code>` (verify) and `/stop` (delete).
 */
export const POST = notifyRoute(
  "v1/notifications/telegram",
  async (request) => {
    const deps = notifyDeps();
    assertTelegramSecret(
      deps,
      request.headers.get("x-telegram-bot-api-secret-token"),
    );
    const body = await readLimitedJson(request, 16_384);
    return Response.json(await handleTelegramUpdate(deps, body), {
      headers: noStore,
    });
  },
);
