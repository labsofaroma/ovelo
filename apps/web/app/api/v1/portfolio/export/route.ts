import { assertExportAllowed, exportCsv } from "@/features/portfolio/export";
import { errorResponse } from "@/server/http";
import { openSession } from "@/server/wallet-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/portfolio/export `Authorization: Bearer ws1.portfolio…` → text/csv of THIS wallet's
 * Ovelo orders and P&L (the session's wallet; there is no wallet parameter). 5 per 10 minutes.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const wallet = openSession(
      "portfolio",
      request.headers.get("authorization"),
    );
    await assertExportAllowed(wallet);
    const csv = await exportCsv(wallet);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="ovelo-${wallet.slice(0, 8)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error, { route: "v1/portfolio/export" });
  }
}
