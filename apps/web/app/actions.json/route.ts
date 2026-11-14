import { NextResponse } from "next/server";
import { actionHeaders } from "@/lib/server/recurring-actions";
import { actionsJsonRules } from "@/features/baskets/actions-json";
import { isV1Enabled } from "@/server/env";

export const runtime = "nodejs";
// Read the flag per request (it decides the v1 rule), not once at build time.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { rules: actionsJsonRules(isV1Enabled()) },
    { headers: { ...actionHeaders(), "Cache-Control": "public, max-age=300" } },
  );
}
export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: actionHeaders() });
}
