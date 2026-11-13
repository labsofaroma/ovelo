import { walletParamSchema } from "@/features/portfolio/schema";
import { loadPortfolio } from "@/features/portfolio/service";
import { isV1Enabled } from "@/server/env";
import { AppError } from "@/server/errors";
import { errorResponse, parseValue } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/portfolio/:wallet: mainnet balances valued with the cached issuer snapshot (each
 * price with source and as-of), plus this wallet's Aroma receipts. Public chain data only.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ wallet: string }> },
): Promise<Response> {
  try {
    if (!isV1Enabled()) throw new AppError("NOT_FOUND");
    const wallet = parseValue(walletParamSchema, (await params).wallet);
    return Response.json(await loadPortfolio(wallet), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, { route: "v1/portfolio/[wallet]" });
  }
}
