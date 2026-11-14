import { NextResponse } from "next/server";
import { actionHeaders } from "@/lib/server/recurring-actions";
import { V1_ACTION_RULE } from "@/features/baskets/actions-json";
import { isV1Enabled } from "@/server/env";

export const runtime = "nodejs";
// Read the flag per request (it decides the v1 rule), not once at build time.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      rules: [
        ...(isV1Enabled() ? [V1_ACTION_RULE] : []),
        { pathPattern: "/api/actions/**", apiPath: "/api/actions/**" },
        { pathPattern: "/basket/*", apiPath: "/api/actions/buy-baskets/*" },
        { pathPattern: "/baskets/*", apiPath: "/api/actions/buy-baskets/*" },
      ],
    },
    { headers: { ...actionHeaders(), "Cache-Control": "public, max-age=300" } },
  );
}
export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: actionHeaders() });
}
